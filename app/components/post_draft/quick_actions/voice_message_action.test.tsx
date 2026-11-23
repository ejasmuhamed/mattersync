// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import {AudioModule, getRecordingPermissionsAsync, requestRecordingPermissionsAsync, setAudioModeAsync, useAudioRecorderState, type AudioRecorder, type RecordingStatus} from 'expo-audio';
import {Directory, File} from 'expo-file-system';
import {type ComponentProps} from 'react';
import {Alert, AppState} from 'react-native';
import ReactNativeHapticFeedback from 'react-native-haptic-feedback';

import {setCurrentCall} from '@calls/state';
import {DefaultCurrentCall} from '@calls/types/calls';
import ServerUrlProvider from '@context/server';
import VoiceRecordingStore from '@store/voice_recording_store';
import {act, fireEvent, renderWithIntlAndTheme, waitFor} from '@test/intl-test-helper';

import VoiceMessageAction from './voice_message_action';

// Taps in these tests are deliberate and quick; the double-tap guard would drop some depending on timing.
jest.mock('@hooks/utils', () => ({
    ...jest.requireActual('@hooks/utils'),
    usePreventDoubleTap: (callback: () => void) => callback,
}));

const RECORDING_URI = 'file:///cache/recording.m4a';
const SERVER = {url: 'https://chat.example.com', displayName: 'Test server'};

function fileUri(parts: Array<string | Directory | File>) {
    return parts.map((part) => (typeof part === 'string' ? part : part.uri)).reduce((uri, part) => `${uri.replace(/\/$/, '')}/${part}`, '').slice(1);
}

describe('VoiceMessageAction', () => {
    let duration: number;
    let files: Map<string, number>;
    let deletedUris: string[];
    let recorder: AudioRecorder;
    let onRecordingStatus: ((status: RecordingStatus) => void) | undefined;

    const getBaseProps = (): ComponentProps<typeof VoiceMessageAction> => ({
        testID: 'voice',
        disabled: false,
        onUploadFiles: jest.fn(),
    });

    const renderAction = (props: ComponentProps<typeof VoiceMessageAction>) => renderWithIntlAndTheme(
        <ServerUrlProvider server={SERVER}>
            <VoiceMessageAction {...props}/>
        </ServerUrlProvider>,
    );

    beforeEach(() => {
        jest.clearAllMocks();
        setCurrentCall(null);
        duration = 2000;
        files = new Map();
        deletedUris = [];
        recorder = {
            uri: null,
            isRecording: false,
            prepareToRecordAsync: jest.fn().mockResolvedValue(undefined),
            record: jest.fn(() => {
                Object.assign(recorder, {isRecording: true, uri: RECORDING_URI});
                files.set(RECORDING_URI, 16000);
            }),
            stop: jest.fn(async () => {
                Object.assign(recorder, {isRecording: false});
            }),
            pause: jest.fn(() => {
                Object.assign(recorder, {isRecording: false});
            }),
            getStatus: jest.fn(() => ({durationMillis: duration, isRecording: recorder.isRecording})),
            addListener: jest.fn((_event: string, listener: (status: RecordingStatus) => void) => {
                onRecordingStatus = listener;
                return {remove: jest.fn()};
            }),
            release: jest.fn(),
        } as unknown as AudioRecorder;
        onRecordingStatus = undefined;
        jest.mocked(AudioModule.AudioRecorder).mockImplementation(() => recorder);
        jest.mocked(useAudioRecorderState).mockImplementation(() => ({
            isRecording: recorder.isRecording,
            durationMillis: duration,
        } as ReturnType<typeof useAudioRecorderState>));
        jest.mocked(requestRecordingPermissionsAsync).mockResolvedValue({granted: true} as Awaited<ReturnType<typeof requestRecordingPermissionsAsync>>);
        jest.mocked(Directory).mockImplementation((...parts) => ({uri: fileUri(parts), create: jest.fn()} as unknown as Directory));
        jest.mocked(File).mockImplementation((...parts) => {
            const uri = fileUri(parts);
            return {
                uri,
                get exists() {
                    return files.has(uri);
                },
                get size() {
                    return files.get(uri) ?? 0;
                },
                move(destination: File) {
                    files.set(destination.uri, files.get(uri) ?? 0);
                    files.delete(uri);
                },
                delete() {
                    deletedUris.push(uri);
                    files.delete(uri);
                },
            } as File;
        });
    });

    afterEach(() => {
        act(() => setCurrentCall(null));
    });

    it('should prepare the microphone on touch-down so the tap starts recording without the setup again', async () => {
        const haptic = jest.spyOn(ReactNativeHapticFeedback, 'trigger');
        const screen = renderAction(getBaseProps());
        const mic = screen.getByTestId('voice');

        fireEvent(mic, 'pressIn');
        await waitFor(() => expect(recorder.prepareToRecordAsync).toHaveBeenCalledTimes(1));
        expect(recorder.record).not.toHaveBeenCalled();
        expect(haptic).not.toHaveBeenCalled();

        fireEvent(mic, 'pressOut');
        fireEvent.press(mic);

        await waitFor(() => expect(recorder.record).toHaveBeenCalledTimes(1));
        expect(recorder.prepareToRecordAsync).toHaveBeenCalledTimes(1);
        expect(requestRecordingPermissionsAsync).not.toHaveBeenCalled();
        expect(haptic).toHaveBeenCalledTimes(1);
        haptic.mockRestore();
    });

    it('should undo a touch-down warm-up when the touch never becomes a tap', async () => {
        const screen = renderAction(getBaseProps());
        const mic = screen.getByTestId('voice');

        fireEvent(mic, 'pressIn');
        await waitFor(() => expect(recorder.prepareToRecordAsync).toHaveBeenCalledTimes(1));
        expect(VoiceRecordingStore.isRecording()).toBe(true);
        fireEvent(mic, 'pressOut');

        await waitFor(() => expect(setAudioModeAsync).toHaveBeenLastCalledWith({allowsRecording: false}), {timeout: 2000});
        expect(VoiceRecordingStore.isRecording()).toBe(false);
        expect(recorder.record).not.toHaveBeenCalled();
        expect(screen.queryByTestId('voice.bar')).toBeNull();
    });

    it('should not warm up before microphone permission was granted, so the prompt does not swallow the tap', async () => {
        jest.mocked(getRecordingPermissionsAsync).mockResolvedValueOnce({granted: false} as Awaited<ReturnType<typeof getRecordingPermissionsAsync>>);
        const screen = renderAction(getBaseProps());
        const mic = screen.getByTestId('voice');

        fireEvent(mic, 'pressIn');
        await waitFor(() => expect(getRecordingPermissionsAsync).toHaveBeenCalled());
        expect(recorder.prepareToRecordAsync).not.toHaveBeenCalled();

        fireEvent(mic, 'pressOut');
        fireEvent.press(mic);

        await waitFor(() => expect(recorder.record).toHaveBeenCalledTimes(1));
        expect(requestRecordingPermissionsAsync).toHaveBeenCalledTimes(1);
    });

    it('should explain denied microphone permission without recording or uploading', async () => {
        jest.mocked(requestRecordingPermissionsAsync).mockResolvedValue({granted: false} as Awaited<ReturnType<typeof requestRecordingPermissionsAsync>>);
        const props = getBaseProps();
        const screen = renderAction(props);

        fireEvent.press(screen.getByTestId('voice'));

        await waitFor(() => expect(Alert.alert).toHaveBeenCalledWith('Voice message', expect.stringContaining('Allow microphone access')));
        expect(recorder.record).not.toHaveBeenCalled();
        expect(props.onUploadFiles).not.toHaveBeenCalled();
        expect(setAudioModeAsync).not.toHaveBeenCalledWith(expect.objectContaining({allowsRecording: true}));
    });

    it('should attach an m4a audio file inside the server cache through the draft upload callback', async () => {
        const props = getBaseProps();
        const screen = renderAction(props);

        fireEvent.press(screen.getByTestId('voice'));
        await waitFor(() => expect(screen.getByTestId('voice.attach')).not.toBeDisabled());
        expect(screen.getByTestId('voice.timer')).toHaveTextContent('00:02');
        fireEvent.press(screen.getByTestId('voice.attach'));

        await waitFor(() => expect(props.onUploadFiles).toHaveBeenCalledTimes(1));
        const uploadedFiles = jest.mocked(props.onUploadFiles).mock.calls[0][0];
        expect(uploadedFiles).toHaveLength(1);
        expect(uploadedFiles[0]).toEqual(expect.objectContaining({
            clientId: expect.any(String),
            extension: 'm4a',
            mime_type: 'audio/mp4',
            name: expect.stringMatching(/^voice-message-.+\.m4a$/),
            localPath: expect.stringMatching(/^file:\/\/test-cache-directory\/aHR0cHM6Ly9jaGF0LmV4YW1wbGUuY29t\/Files\/voice-message-.+\.m4a$/),
            size: 16000,
        }));
        expect(files.get(uploadedFiles[0].localPath ?? '')).toBe(16000);
        expect(AudioModule.AudioRecorder).toHaveBeenCalledWith(expect.objectContaining({extension: '.m4a', numberOfChannels: 1, bitRate: 64000}));
        expect(recorder.prepareToRecordAsync).toHaveBeenCalledWith(expect.objectContaining({extension: '.m4a', numberOfChannels: 1, bitRate: 64000}));
        await waitFor(() => expect(screen.queryByTestId('voice.attach')).toBeNull());
    });

    it('should create a new native recorder for every take', async () => {
        const props = getBaseProps();
        const screen = renderAction(props);
        const constructedBeforeTakes = jest.mocked(AudioModule.AudioRecorder).mock.calls.length;

        // Two full takes run back to back, which can exceed the default wait when the suite runs alongside others.
        const slowWait = {timeout: 5000};
        for (let take = 1; take <= 2; take++) {
            fireEvent.press(screen.getByTestId('voice'));
            // eslint-disable-next-line no-await-in-loop
            await waitFor(() => expect(screen.getByTestId('voice.attach')).not.toBeDisabled(), slowWait);
            fireEvent.press(screen.getByTestId('voice.attach'));
            // eslint-disable-next-line no-await-in-loop
            await waitFor(() => expect(screen.queryByTestId('voice.attach')).toBeNull(), slowWait);
        }

        expect(jest.mocked(AudioModule.AudioRecorder).mock.calls.length - constructedBeforeTakes).toBe(2);
        expect(props.onUploadFiles).toHaveBeenCalledTimes(2);
    });

    it('should mark a voice recording as active only while a take is in progress', async () => {
        const screen = renderAction(getBaseProps());
        expect(VoiceRecordingStore.isRecording()).toBe(false);

        fireEvent.press(screen.getByTestId('voice'));
        await waitFor(() => expect(recorder.record).toHaveBeenCalled());
        expect(VoiceRecordingStore.isRecording()).toBe(true);

        fireEvent.press(screen.getByTestId('voice.attach'));
        await waitFor(() => expect(screen.queryByTestId('voice.attach')).toBeNull());
        expect(VoiceRecordingStore.isRecording()).toBe(false);
    });

    it('should delete a cancelled recording and restore the audio mode without uploading', async () => {
        const props = getBaseProps();
        const screen = renderAction(props);

        fireEvent.press(screen.getByTestId('voice'));
        await waitFor(() => expect(recorder.record).toHaveBeenCalled());
        await act(async () => {
            fireEvent.press(screen.getByTestId('voice.discard'));
        });

        await waitFor(() => expect(screen.queryByTestId('voice.discard')).toBeNull());
        expect(deletedUris).toContain(RECORDING_URI);
        expect(recorder.isRecording).toBe(false);
        expect(setAudioModeAsync).toHaveBeenLastCalledWith({allowsRecording: false});
        expect(props.onUploadFiles).not.toHaveBeenCalled();
    });

    it('should block microphone access when file uploads are disabled', () => {
        const props = {...getBaseProps(), disabled: true};
        const screen = renderAction(props);

        const button = screen.getByTestId('voice.disabled');
        expect(button).toBeDisabled();
        fireEvent.press(button);

        expect(requestRecordingPermissionsAsync).not.toHaveBeenCalled();
    });

    it('should block recording while a Mattermost call is active', () => {
        setCurrentCall({...DefaultCurrentCall});
        const screen = renderAction(getBaseProps());

        expect(screen.getByTestId('voice.disabled')).toBeDisabled();
        expect(requestRecordingPermissionsAsync).not.toHaveBeenCalled();
    });

    it('should not begin recording when cancelled during the permission request', async () => {
        let grantPermission: (value: Awaited<ReturnType<typeof requestRecordingPermissionsAsync>>) => void = () => {};
        jest.mocked(requestRecordingPermissionsAsync).mockReturnValue(new Promise((resolve) => {
            grantPermission = resolve;
        }));
        const props = getBaseProps();
        const screen = renderAction(props);

        fireEvent.press(screen.getByTestId('voice'));
        await waitFor(() => expect(requestRecordingPermissionsAsync).toHaveBeenCalled());
        fireEvent.press(screen.getByTestId('voice.discard'));
        await act(async () => {
            grantPermission({granted: true} as Awaited<ReturnType<typeof requestRecordingPermissionsAsync>>);
        });

        await waitFor(() => expect(screen.queryByTestId('voice.discard')).toBeNull());
        expect(recorder.record).not.toHaveBeenCalled();
        expect(props.onUploadFiles).not.toHaveBeenCalled();
    });

    it('should not access the released recorder after unmounting during a permission request', async () => {
        let grantPermission: (value: Awaited<ReturnType<typeof requestRecordingPermissionsAsync>>) => void = () => {};
        jest.mocked(requestRecordingPermissionsAsync).mockReturnValue(new Promise((resolve) => {
            grantPermission = resolve;
        }));
        const props = getBaseProps();
        const screen = renderAction(props);

        fireEvent.press(screen.getByTestId('voice'));
        await waitFor(() => expect(requestRecordingPermissionsAsync).toHaveBeenCalled());
        screen.unmount();
        const releasedGetter = jest.fn(() => {
            throw new Error('Native shared object has been released');
        });
        Object.defineProperty(recorder, 'isRecording', {get: releasedGetter});
        await act(async () => {
            grantPermission({granted: true} as Awaited<ReturnType<typeof requestRecordingPermissionsAsync>>);
        });

        expect(releasedGetter).not.toHaveBeenCalled();
        expect(recorder.record).not.toHaveBeenCalled();
        expect(props.onUploadFiles).not.toHaveBeenCalled();
        expect(Alert.alert).not.toHaveBeenCalled();
    });

    it('should pause and keep the recording when the app moves to the background', async () => {
        const props = getBaseProps();
        const screen = renderAction(props);

        fireEvent.press(screen.getByTestId('voice'));
        await waitFor(() => expect(recorder.record).toHaveBeenCalled());
        const listeners = jest.mocked(AppState.addEventListener).mock.calls;
        const onStateChange = listeners[listeners.length - 1][1];
        await act(async () => {
            onStateChange('background');
        });

        expect(recorder.pause).toHaveBeenCalledTimes(1);
        expect(screen.getByTestId('voice.resume')).toBeTruthy();
        expect(files.has(RECORDING_URI)).toBe(true);
        expect(props.onUploadFiles).not.toHaveBeenCalled();
    });

    it('should pause and resume the same take', async () => {
        const props = getBaseProps();
        const screen = renderAction(props);

        fireEvent.press(screen.getByTestId('voice'));
        await waitFor(() => expect(recorder.record).toHaveBeenCalledTimes(1));

        fireEvent.press(screen.getByTestId('voice.pause'));
        expect(recorder.pause).toHaveBeenCalledTimes(1);
        fireEvent.press(screen.getByTestId('voice.resume'));

        expect(recorder.record).toHaveBeenCalledTimes(2);
        expect(AudioModule.AudioRecorder).toHaveBeenCalledTimes(2);
        expect(screen.getByTestId('voice.pause')).toBeTruthy();
    });

    it('should keep recording when sending a take shorter than one second', async () => {
        duration = 500;
        const props = {...getBaseProps(), onSendFiles: jest.fn()};
        const screen = renderAction(props);

        fireEvent.press(screen.getByTestId('voice'));
        await waitFor(() => expect(recorder.record).toHaveBeenCalled());
        fireEvent.press(screen.getByTestId('voice.send'));

        expect(Alert.alert).toHaveBeenCalledWith('Voice message', expect.stringContaining('too short'));
        expect(recorder.stop).not.toHaveBeenCalled();
        expect(props.onSendFiles).not.toHaveBeenCalled();
        expect(screen.getByTestId('voice.bar')).toBeTruthy();
    });

    it('should send the recording straight away when send is pressed', async () => {
        const props = {...getBaseProps(), onSendFiles: jest.fn()};
        const screen = renderAction(props);

        fireEvent.press(screen.getByTestId('voice'));
        await waitFor(() => expect(recorder.record).toHaveBeenCalled());
        fireEvent.press(screen.getByTestId('voice.send'));

        await waitFor(() => expect(props.onSendFiles).toHaveBeenCalledTimes(1));
        expect(jest.mocked(props.onSendFiles).mock.calls[0][0]).toHaveLength(1);
        expect(props.onUploadFiles).not.toHaveBeenCalled();
        await waitFor(() => expect(screen.queryByTestId('voice.bar')).toBeNull());
    });

    it('should only offer adding to the message when sending is not available', async () => {
        const screen = renderAction(getBaseProps());

        fireEvent.press(screen.getByTestId('voice'));
        await waitFor(() => expect(recorder.record).toHaveBeenCalled());

        expect(screen.queryByTestId('voice.send')).toBeNull();
        expect(screen.getByTestId('voice.attach')).toBeTruthy();
    });

    it('should allow attaching a recording stopped by the native recorder', async () => {
        const props = getBaseProps();
        const screen = renderAction(props);

        fireEvent.press(screen.getByTestId('voice'));
        await waitFor(() => expect(recorder.record).toHaveBeenCalled());
        act(() => {
            Object.assign(recorder, {isRecording: false});
            onRecordingStatus?.({id: 'recording', isFinished: true, hasError: false, error: null, url: RECORDING_URI});
        });

        expect(screen.getByTestId('voice.attach')).not.toBeDisabled();
        fireEvent.press(screen.getByTestId('voice.attach'));
        await waitFor(() => expect(props.onUploadFiles).toHaveBeenCalledTimes(1));
        await waitFor(() => expect(screen.queryByTestId('voice.attach')).toBeNull());
    });

    it('should discard an interrupted recording when native audio reports an error', async () => {
        const props = getBaseProps();
        const screen = renderAction(props);

        fireEvent.press(screen.getByTestId('voice'));
        await waitFor(() => expect(recorder.record).toHaveBeenCalled());
        await act(async () => {
            onRecordingStatus?.({id: 'recording', isFinished: false, hasError: true, error: 'Recorder interrupted', url: RECORDING_URI});
        });

        await waitFor(() => expect(screen.queryByTestId('voice.bar')).toBeNull());
        expect(Alert.alert).toHaveBeenCalledWith('Voice message', expect.stringContaining('Unable to record'));
        expect(deletedUris).toContain(RECORDING_URI);
        expect(props.onUploadFiles).not.toHaveBeenCalled();
    });
});
