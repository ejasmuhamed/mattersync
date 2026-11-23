// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import {AudioModule, getRecordingPermissionsAsync, RecordingPresets, requestRecordingPermissionsAsync, setAudioModeAsync, useAudioRecorderState, type AudioRecorder, type RecordingStatus} from 'expo-audio';
import {Directory, File, Paths} from 'expo-file-system';
import React, {useCallback, useEffect, useRef, useState} from 'react';
import {defineMessages, useIntl} from 'react-intl';
import {Alert, AppState, Platform, Pressable} from 'react-native';

import {getCurrentCall, useCurrentCall} from '@calls/state';
import CompassIcon from '@components/compass_icon';
import {ICON_SIZE} from '@constants/post_draft';
import {useKeyboardState} from '@context/keyboard_state';
import {useServerUrl} from '@context/server';
import {useTheme} from '@context/theme';
import {usePreventDoubleTap} from '@hooks/utils';
import VoiceRecordingStore from '@store/voice_recording_store';
import {getFullErrorMessage} from '@utils/errors';
import {deleteFile} from '@utils/file';
import {generateId, hapticFeedback} from '@utils/general';
import {logDebug, logError} from '@utils/log';
import {urlSafeBase64Encode} from '@utils/security';
import {changeOpacity, makeStyleSheetFromTheme} from '@utils/theme';

import VoiceRecordingBar, {type RecordingPhase} from './voice_recording_bar';

const messages = defineMessages({
    title: {id: 'voice_message.title', defaultMessage: 'Voice message'},
    record: {id: 'voice_message.record', defaultMessage: 'Record a voice message'},
    permission: {id: 'voice_message.permission', defaultMessage: 'Allow microphone access in your device settings to record a voice message.'},
    error: {id: 'voice_message.error', defaultMessage: 'Unable to record this voice message. Please try again.'},
    empty: {id: 'voice_message.empty', defaultMessage: 'The recording was too short. Please record at least one second.'},
});

const RECORDING_OPTIONS = {...RecordingPresets.HIGH_QUALITY, numberOfChannels: 1, bitRate: 64000};

// A new native recorder is created for every take. Reusing one leaves stale native state, and later takes fail to prepare.
const createRecorder = () => new AudioModule.AudioRecorder({
    ...RECORDING_OPTIONS,
    ...(Platform.OS === 'ios' ? RECORDING_OPTIONS.ios : RECORDING_OPTIONS.android),
});
const MIN_DURATION_MS = 1000;

// Enforced here rather than with record({forDuration}), because a native duration limit is lost after pause and resume.
const MAX_DURATION_MS = 300000;

// How long a touch-down warm-up waits for the tap to complete before it is undone (e.g. the touch became a scroll).
const WARMUP_GRACE_MS = 600;

type Phase = RecordingPhase;
type FinishMode = 'attach' | 'send';
type Take = {session: number; fresh: AudioRecorder};
type Warmup = Take & {ready: Promise<boolean>};

const getStyleSheet = makeStyleSheetFromTheme((theme) => ({
    iconContainer: {
        backgroundColor: changeOpacity(theme.centerChannelColor, 0.08),
        borderRadius: 20,
        alignItems: 'center',
        alignSelf: 'center',
        justifyContent: 'center',
        width: 40,
        height: 40,
        marginRight: 8,
    },
    pressed: {opacity: 0.64},
}));

type Props = {
    testID?: string;
    disabled: boolean;
    onUploadFiles: (files: FileInfo[]) => void;

    /** Sends the recording straight away. Without it (e.g. when editing a post) the recording can only be added to the message. */
    onSendFiles?: (files: FileInfo[]) => void;
};

export default function VoiceMessageAction({testID = 'voice_message', disabled, onUploadFiles, onSendFiles}: Props) {
    const theme = useTheme();
    const serverUrl = useServerUrl();
    const style = getStyleSheet(theme);
    const intl = useIntl();
    const {blurAndDismissKeyboard} = useKeyboardState();
    const currentCall = useCurrentCall();
    const recordingEvent = useRef<(event: RecordingStatus) => void>(() => { /* No recording has started. */ });
    const [recorder, setRecorder] = useState<AudioRecorder>(createRecorder);

    // Async operations read the current take's recorder from this ref, so cleanUp stays stable and the unmount effect only runs on unmount.
    const recorderRef = useRef(recorder);
    const status = useAudioRecorderState(recorder);

    useEffect(() => {
        const subscription = recorder.addListener('recordingStatusUpdate', (event) => recordingEvent.current(event));
        return () => {
            subscription.remove();

            // Releases the previous take's native recorder when a new one replaces it, and on unmount.
            recorder.release();
        };
    }, [recorder]);
    const [phase, setPhase] = useState<Phase>('closed');
    const phaseRef = useRef(phase);
    const durationRef = useRef(0);
    const temporaryUri = useRef<string | null>(null);
    const mounted = useRef(true);
    const transition = useCallback((next: Phase) => {
        phaseRef.current = next;
        if (mounted.current) {
            setPhase(next);
        }
    }, []);
    const operation = useRef(Promise.resolve());
    const generation = useRef(0);
    const busy = useRef(false);
    const ownsAudioMode = useRef(false);
    const warmup = useRef<Warmup | null>(null);
    const warmupDiscardTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
    const unavailable = disabled || Boolean(currentCall);

    const cleanUp = useCallback(async () => {
        if (!ownsAudioMode.current && !temporaryUri.current) {
            VoiceRecordingStore.setRecording(false);
            return;
        }
        let uri = temporaryUri.current;
        const current = recorderRef.current;
        try {
            uri = current.uri ?? uri;
            await current.stop();
            uri = current.uri ?? uri;
        } catch { /* The recorder may already have been stopped or released on unmount. */ }
        if (uri) {
            deleteFile(uri);
        }
        temporaryUri.current = null;
        if (ownsAudioMode.current) {
            ownsAudioMode.current = false;
            if (!getCurrentCall()) {
                await setAudioModeAsync({allowsRecording: false}).catch(() => { /* The device audio session may already have been released. */ });
            }
        }
        VoiceRecordingStore.setRecording(false);
    }, []);

    const close = useCallback(() => {
        generation.current += 1;
        busy.current = true;
        if (mounted.current) {
            transition('stopping');
        }
        operation.current = operation.current.then(cleanUp).finally(() => {
            busy.current = false;
            if (mounted.current) {
                transition('closed');
            }
        });
    }, [cleanUp, transition]);

    // Undoes a touch-down warm-up that never became a recording. Cleanup waits for the warm-up to settle,
    // so a late audio-mode change cannot slip in after the audio mode has been restored.
    const discardWarmup = useCallback(() => {
        clearTimeout(warmupDiscardTimer.current);
        const warm = warmup.current;
        if (!warm) {
            return;
        }
        warmup.current = null;
        generation.current += 1;
        operation.current = operation.current.then(() => warm.ready).then(cleanUp);
    }, [cleanUp]);

    useEffect(() => {
        mounted.current = true;
        return () => {
            mounted.current = false;
            discardWarmup();
            generation.current += 1;
            operation.current = operation.current.then(cleanUp);
        };
    }, [cleanUp, discardWarmup]);

    useEffect(() => {
        if (unavailable && phase !== 'closed' && phase !== 'stopping') {
            logDebug('VoiceMessageAction closing: unavailable');
            close();
        }
    }, [unavailable, phase, close]);

    const pause = useCallback(() => {
        if (phaseRef.current !== 'recording') {
            return;
        }
        const current = recorderRef.current;
        current.pause();
        durationRef.current = Math.max(durationRef.current, current.getStatus().durationMillis);
        transition('paused');
    }, [transition]);

    useEffect(() => {
        const listener = AppState.addEventListener('change', (state) => {
            // Keep the take when the app leaves the foreground; the user can resume or send it on return.
            if (state !== 'active' && phaseRef.current === 'recording') {
                logDebug('VoiceMessageAction pausing: app state', state);
                pause();
            }
        });
        return () => listener.remove();
    }, [pause]);

    const alert = (message: keyof typeof messages) => {
        if (mounted.current) {
            Alert.alert(intl.formatMessage(messages.title), intl.formatMessage(messages[message]));
        }
    };

    const beginTake = (): Take => {
        // Set before the audio session is configured so audio players stop resetting it; cleanUp clears it on every exit path.
        VoiceRecordingStore.setRecording(true);
        const session = ++generation.current;
        durationRef.current = 0;
        const fresh = createRecorder();
        recorderRef.current = fresh;
        setRecorder(fresh);
        return {session, fresh};
    };

    // Switches the audio session to recording and readies the recorder. This is the slow part of starting a take.
    const prepareAudio = async ({session, fresh}: Take) => {
        if (getCurrentCall()) {
            return false;
        }
        ownsAudioMode.current = true;
        await setAudioModeAsync({allowsRecording: true, playsInSilentMode: true, allowsBackgroundRecording: false});
        if (session !== generation.current) {
            return false;
        }

        // Passing options makes expo-audio create a fresh native recorder and file; without them, a reused recorder fails or writes an empty file after the first take.
        await fresh.prepareToRecordAsync(RECORDING_OPTIONS);
        return session === generation.current;
    };

    // Touch-down on the mic starts the slow audio setup, so recording can begin almost as soon as the tap completes.
    // It only runs once permission was already granted: a permission prompt here would swallow the tap.
    const warmUp = () => {
        if (unavailable || busy.current || phaseRef.current !== 'closed' || warmup.current) {
            return;
        }
        const take = beginTake();
        const ready = getRecordingPermissionsAsync().
            then((permission) => (permission.granted && take.session === generation.current ? prepareAudio(take) : false)).
            catch((error) => {
                logError('VoiceMessageAction.warmUp failed', getFullErrorMessage(error));
                return false;
            });
        warmup.current = {...take, ready};
    };

    const onPressOut = () => {
        if (!warmup.current) {
            return;
        }

        // A tap fires onPress right after this; a scroll or cancelled touch never does, so undo the warm-up after a moment.
        clearTimeout(warmupDiscardTimer.current);
        warmupDiscardTimer.current = setTimeout(discardWarmup, WARMUP_GRACE_MS);
    };

    const start = usePreventDoubleTap(() => {
        if (unavailable || busy.current || phase !== 'closed') {
            return;
        }
        busy.current = true;
        clearTimeout(warmupDiscardTimer.current);
        const warm = warmup.current;
        warmup.current = null;
        const take = warm ?? beginTake();
        const {session, fresh} = take;
        transition('preparing');

        // Recording does not need the keyboard gone first, so don't wait for its closing animation.
        blurAndDismissKeyboard();
        operation.current = operation.current.then(async () => {
            let started = false;
            try {
                let ready = warm ? await warm.ready : false;
                if (session !== generation.current) {
                    return;
                }
                if (!ready) {
                    // No warm-up, permission not granted yet, or the warm-up failed: run the full setup.
                    const permission = await requestRecordingPermissionsAsync();
                    if (session !== generation.current) {
                        return;
                    }
                    if (!permission.granted) {
                        alert('permission');
                        return;
                    }
                    ready = await prepareAudio(take);
                }
                if (!ready || session !== generation.current || getCurrentCall() || AppState.currentState !== 'active') {
                    return;
                }
                temporaryUri.current = fresh.uri;
                fresh.record();
                started = true;
                transition('recording');

                // The "go" cue: from this moment the microphone is really capturing.
                hapticFeedback();
            } catch (error) {
                logError('VoiceMessageAction.start failed', getFullErrorMessage(error));
                alert('error');
            } finally {
                busy.current = false;

                // Use the local flag: recorder.isRecording can still be false right after record() on a second attempt.
                if (!mounted.current || !started) {
                    await cleanUp();
                    if (mounted.current && session === generation.current) {
                        transition('closed');
                    }
                }
            }
        });
    });

    const resume = usePreventDoubleTap(() => {
        if (unavailable || phaseRef.current !== 'paused') {
            return;
        }
        try {
            recorderRef.current.record();
            transition('recording');
        } catch (error) {
            logError('VoiceMessageAction.resume failed', getFullErrorMessage(error));
            alert('error');
        }
    });

    const finish = (mode: FinishMode) => {
        if (busy.current || unavailable || (phase !== 'recording' && phase !== 'paused' && phase !== 'ready')) {
            return;
        }
        const current = recorderRef.current;
        const duration = Math.max(durationRef.current, current.getStatus().durationMillis);
        if (duration < MIN_DURATION_MS) {
            // Keep the take going rather than throwing it away; the user just needs to record a little longer.
            alert('empty');
            return;
        }
        busy.current = true;
        const session = generation.current;
        transition('stopping');
        operation.current = operation.current.then(async () => {
            let destination: File | undefined;
            try {
                // Always finalize the file before moving it: recorder.isRecording can be stale, and an unfinished m4a plays as 0:00.
                // stop() can throw if the recorder already finished on its own, so that case is ignored.
                try {
                    await current.stop();
                } catch {
                    // Already stopped.
                }
                const uri = current.uri ?? temporaryUri.current;
                if (!uri || session !== generation.current || !mounted.current) {
                    return;
                }
                const source = new File(uri);
                if (!source.exists || source.size === 0) {
                    throw new Error('Empty voice recording');
                }
                const clientId = generateId();
                const name = `voice-message-${clientId}.m4a`;

                // Keep recordings in the server cache so logout and cache clearing remove them.
                const directory = new Directory(Paths.cache, urlSafeBase64Encode(serverUrl), 'Files');
                directory.create({idempotent: true, intermediates: true});
                destination = new File(directory, name);
                source.move(destination);
                const voiceFiles: FileInfo[] = [{
                    clientId,
                    extension: 'm4a',
                    mime_type: 'audio/mp4',
                    name,
                    size: destination.size,
                    localPath: destination.uri,
                    has_preview_image: false,
                    width: 0,
                    height: 0,
                    user_id: '',
                }];
                if (mode === 'send' && onSendFiles) {
                    onSendFiles(voiceFiles);
                } else {
                    onUploadFiles(voiceFiles);
                }
                destination = undefined;
            } catch (error) {
                logError('VoiceMessageAction.finish failed', getFullErrorMessage(error));
                if (destination) {
                    deleteFile(destination.uri);
                }
                alert('error');
            } finally {
                await cleanUp();
                busy.current = false;
                if (mounted.current) {
                    transition('closed');
                }
            }
        });
    };

    const attach = usePreventDoubleTap(() => finish('attach'));
    const send = usePreventDoubleTap(() => finish('send'));

    useEffect(() => {
        if (phase === 'recording' && phaseRef.current === 'recording') {
            const current = recorderRef.current;
            const liveStatus = current.getStatus();
            durationRef.current = Math.max(durationRef.current, liveStatus.durationMillis);
            temporaryUri.current = liveStatus.url ?? temporaryUri.current;

            if (durationRef.current >= MAX_DURATION_MS) {
                logDebug('VoiceMessageAction reached the maximum duration');
                current.pause();
                transition('ready');
                return;
            }

            // Native interruptions can stop recording without a finished event.
            if (!liveStatus.isRecording && durationRef.current > 0) {
                transition('ready');
            }
        }
    }, [phase, status.durationMillis, status.isRecording, status.url, transition]);

    useEffect(() => {
        recordingEvent.current = (event) => {
            if (phaseRef.current !== 'recording' && phaseRef.current !== 'paused') {
                return;
            }
            temporaryUri.current = event.url ?? temporaryUri.current;
            if (event.hasError || event.mediaServicesDidReset) {
                logError('VoiceMessageAction recorder event', {hasError: event.hasError, mediaServicesDidReset: event.mediaServicesDidReset});
                close();
                Alert.alert(intl.formatMessage(messages.title), intl.formatMessage(messages.error));
            } else if (event.isFinished) {
                transition('ready');
            }
        };
    }, [close, intl, transition]);

    const isActive = phase === 'recording' || phase === 'paused' || phase === 'ready';
    const duration = isActive || phase === 'stopping' ? Math.max(status.durationMillis, durationRef.current) : 0;
    const seconds = Math.floor(duration / 1000);
    const timer = `${Math.floor(seconds / 60).toString().padStart(2, '0')}:${(seconds % 60).toString().padStart(2, '0')}`;
    const iconColor = changeOpacity(theme.centerChannelColor, unavailable ? 0.16 : 0.64);

    return (
        <>
            <Pressable
                testID={unavailable ? `${testID}.disabled` : testID}
                accessibilityRole='button'
                accessibilityLabel={intl.formatMessage(messages.record)}
                disabled={unavailable || phase !== 'closed'}
                onPressIn={warmUp}
                onPressOut={onPressOut}
                onPress={start}
                style={({pressed}) => [style.iconContainer, pressed && style.pressed]}
            >
                <CompassIcon
                    name='microphone'
                    size={ICON_SIZE}
                    color={iconColor}
                />
            </Pressable>
            <VoiceRecordingBar
                testID={testID}
                phase={phase}
                timer={timer}
                canSend={Boolean(onSendFiles)}
                onDiscard={close}
                onPause={pause}
                onResume={resume}
                onAttach={attach}
                onSend={send}
            />
        </>
    );
}
