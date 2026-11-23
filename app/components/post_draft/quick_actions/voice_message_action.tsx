// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import {AudioModule, RecordingPresets, requestRecordingPermissionsAsync, setAudioModeAsync, useAudioRecorderState, type AudioRecorder, type RecordingStatus} from 'expo-audio';
import {Directory, File, Paths} from 'expo-file-system';
import React, {useCallback, useEffect, useRef, useState} from 'react';
import {defineMessages, useIntl} from 'react-intl';
import {Alert, AppState, Modal, Platform, Pressable, Text, View} from 'react-native';

import {getCurrentCall, useCurrentCall} from '@calls/state';
import Button from '@components/button';
import CompassIcon from '@components/compass_icon';
import FormattedText from '@components/formatted_text';
import {ICON_SIZE} from '@constants/post_draft';
import {useKeyboardState} from '@context/keyboard_state';
import {useServerUrl} from '@context/server';
import {useTheme} from '@context/theme';
import {usePreventDoubleTap} from '@hooks/utils';
import VoiceRecordingStore from '@store/voice_recording_store';
import {getFullErrorMessage} from '@utils/errors';
import {deleteFile} from '@utils/file';
import {generateId} from '@utils/general';
import {logDebug, logError} from '@utils/log';
import {urlSafeBase64Encode} from '@utils/security';
import {changeOpacity, makeStyleSheetFromTheme} from '@utils/theme';
import {typography} from '@utils/typography';

const messages = defineMessages({
    title: {id: 'voice_message.title', defaultMessage: 'Voice message'},
    record: {id: 'voice_message.record', defaultMessage: 'Record a voice message'},
    recording: {id: 'voice_message.recording', defaultMessage: 'Recording…'},
    ready: {id: 'voice_message.ready', defaultMessage: 'Recording ready'},
    preparing: {id: 'voice_message.preparing', defaultMessage: 'Preparing microphone…'},
    attach: {id: 'voice_message.attach', defaultMessage: 'Attach recording'},
    cancel: {id: 'voice_message.cancel', defaultMessage: 'Cancel'},
    permission: {id: 'voice_message.permission', defaultMessage: 'Allow microphone access in your device settings to record a voice message.'},
    error: {id: 'voice_message.error', defaultMessage: 'Unable to record this voice message. Please try again.'},
    empty: {id: 'voice_message.empty', defaultMessage: 'The recording was too short. Please record at least one second.'},
    hint: {id: 'voice_message.hint', defaultMessage: 'Attach your recording, then tap Send to share it.'},
});

const RECORDING_OPTIONS = {...RecordingPresets.HIGH_QUALITY, numberOfChannels: 1, bitRate: 64000};

// A new native recorder is created for every take. Reusing one leaves stale native state, and later takes fail to prepare.
const createRecorder = () => new AudioModule.AudioRecorder({
    ...RECORDING_OPTIONS,
    ...(Platform.OS === 'ios' ? RECORDING_OPTIONS.ios : RECORDING_OPTIONS.android),
});
const MIN_DURATION_MS = 1000;
const MAX_DURATION_SECONDS = 300;

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
    overlay: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
        backgroundColor: changeOpacity(theme.centerChannelColor, 0.48),
        padding: 24,
    },
    dialog: {
        backgroundColor: theme.centerChannelBg,
        borderRadius: 12,
        padding: 24,
        gap: 16,
        width: '100%',
        maxWidth: 420,
    },
    title: {color: theme.centerChannelColor, ...typography('Heading', 400, 'SemiBold')},
    body: {color: theme.centerChannelColor, ...typography('Body', 200)},
    timer: {color: theme.errorTextColor, ...typography('Heading', 600, 'SemiBold')},
}));

type Props = {
    testID?: string;
    disabled: boolean;
    onUploadFiles: (files: FileInfo[]) => void;
};

export default function VoiceMessageAction({testID = 'voice_message', disabled, onUploadFiles}: Props) {
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
    const [phase, setPhase] = useState<'closed' | 'preparing' | 'recording' | 'ready' | 'stopping'>('closed');
    const phaseRef = useRef(phase);
    const durationRef = useRef(0);
    const temporaryUri = useRef<string | null>(null);
    const mounted = useRef(true);
    const transition = useCallback((next: typeof phase) => {
        phaseRef.current = next;
        if (mounted.current) {
            setPhase(next);
        }
    }, []);
    const operation = useRef(Promise.resolve());
    const generation = useRef(0);
    const busy = useRef(false);
    const ownsAudioMode = useRef(false);
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

    useEffect(() => {
        mounted.current = true;
        return () => {
            mounted.current = false;
            generation.current += 1;
            operation.current = operation.current.then(cleanUp);
        };
    }, [cleanUp]);

    useEffect(() => {
        if (unavailable && phase !== 'closed' && phase !== 'stopping') {
            logDebug('VoiceMessageAction closing: unavailable');
            close();
        }
    }, [unavailable, phase, close]);

    useEffect(() => {
        const listener = AppState.addEventListener('change', (state) => {
            // Permission dialogs can make the app inactive while preparing.
            if (state !== 'active' && phase === 'recording') {
                logDebug('VoiceMessageAction closing: app state', state);
                close();
            }
        });
        return () => listener.remove();
    }, [phase, close]);

    const alert = (message: keyof typeof messages) => {
        if (mounted.current) {
            Alert.alert(intl.formatMessage(messages.title), intl.formatMessage(messages[message]));
        }
    };

    const start = usePreventDoubleTap(() => {
        if (unavailable || busy.current || phase !== 'closed') {
            return;
        }
        busy.current = true;

        // Set before the audio session is configured so audio players stop resetting it; cleanUp clears it on every exit path.
        VoiceRecordingStore.setRecording(true);
        const session = ++generation.current;
        durationRef.current = 0;
        const fresh = createRecorder();
        recorderRef.current = fresh;
        setRecorder(fresh);
        transition('preparing');
        operation.current = operation.current.then(async () => {
            let started = false;
            try {
                await blurAndDismissKeyboard();
                if (session !== generation.current) {
                    return;
                }
                const permission = await requestRecordingPermissionsAsync();
                if (session !== generation.current) {
                    return;
                }
                if (!permission.granted) {
                    alert('permission');
                    return;
                }
                if (getCurrentCall()) {
                    return;
                }
                ownsAudioMode.current = true;
                await setAudioModeAsync({allowsRecording: true, playsInSilentMode: true, allowsBackgroundRecording: false});
                if (session !== generation.current) {
                    return;
                }

                // Passing options makes expo-audio create a fresh native recorder and file; without them, a reused recorder fails or writes an empty file after the first take.
                await fresh.prepareToRecordAsync(RECORDING_OPTIONS);
                if (session !== generation.current || getCurrentCall() || AppState.currentState !== 'active') {
                    return;
                }
                temporaryUri.current = fresh.uri;
                fresh.record({forDuration: MAX_DURATION_SECONDS});
                started = true;
                transition('recording');
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

    const attach = usePreventDoubleTap(() => {
        if (busy.current || unavailable || (phase !== 'recording' && phase !== 'ready')) {
            return;
        }
        busy.current = true;
        const session = generation.current;
        transition('stopping');
        operation.current = operation.current.then(async () => {
            let destination: File | undefined;
            try {
                const current = recorderRef.current;
                const duration = Math.max(durationRef.current, current.getStatus().durationMillis);

                // Always finalize the file before moving it: recorder.isRecording can be stale, and an unfinished m4a plays as 0:00.
                // stop() can throw if the recorder already finished on its own, so that case is ignored.
                try {
                    await current.stop();
                } catch {
                    // Already stopped.
                }
                if (duration < MIN_DURATION_MS) {
                    alert('empty');
                    return;
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
                onUploadFiles([{
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
                }]);
                destination = undefined;
            } catch (error) {
                logError('VoiceMessageAction.attach failed', getFullErrorMessage(error));
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
    });

    useEffect(() => {
        if (phase === 'recording' && phaseRef.current === 'recording') {
            const liveStatus = recorder.getStatus();
            durationRef.current = Math.max(durationRef.current, liveStatus.durationMillis);
            temporaryUri.current = liveStatus.url ?? temporaryUri.current;

            // Native interruptions can stop recording without a finished event.
            if (!liveStatus.isRecording && durationRef.current > 0) {
                transition('ready');
            }
        }
    }, [phase, recorder, status.durationMillis, status.isRecording, status.url, transition]);

    useEffect(() => {
        recordingEvent.current = (event) => {
            if (phaseRef.current !== 'recording') {
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

    const duration = phase === 'recording' || phase === 'ready' ? Math.max(status.durationMillis, durationRef.current) : 0;
    let recordingLabel = messages.recording;
    if (phase === 'preparing') {
        recordingLabel = messages.preparing;
    } else if (phase === 'ready') {
        recordingLabel = messages.ready;
    }
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
                onPress={start}
                style={({pressed}) => [style.iconContainer, pressed && style.pressed]}
            >
                <CompassIcon
                    name='microphone'
                    size={ICON_SIZE}
                    color={iconColor}
                />
            </Pressable>
            <Modal
                visible={phase !== 'closed'}
                transparent={true}
                animationType='fade'
                onRequestClose={close}
            >
                <View style={style.overlay}>
                    <View
                        style={style.dialog}
                        accessibilityViewIsModal={true}
                    >
                        <FormattedText
                            {...messages.title}
                            style={style.title}
                        />
                        <FormattedText
                            {...recordingLabel}
                            style={style.body}
                        />
                        <Text
                            testID={`${testID}.timer`}
                            style={style.timer}
                        >{timer}</Text>
                        <FormattedText
                            {...messages.hint}
                            style={style.body}
                        />
                        <Button
                            testID={`${testID}.attach`}
                            theme={theme}
                            text={intl.formatMessage(messages.attach)}
                            disabled={(phase !== 'recording' && phase !== 'ready') || duration < MIN_DURATION_MS}
                            onPress={attach}
                        />
                        <Button
                            testID={`${testID}.cancel`}
                            theme={theme}
                            text={intl.formatMessage(messages.cancel)}
                            emphasis='tertiary'
                            disabled={phase === 'stopping'}
                            onPress={close}
                        />
                    </View>
                </View>
            </Modal>
        </>
    );
}
