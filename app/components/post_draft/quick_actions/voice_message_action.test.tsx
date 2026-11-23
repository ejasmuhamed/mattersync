// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import {AudioModule, requestRecordingPermissionsAsync, setAudioModeAsync, useAudioRecorderState, type AudioRecorder, type RecordingStatus} from 'expo-audio';
import {Directory, File} from 'expo-file-system';
import {type ComponentProps} from 'react';
import {Alert, AppState} from 'react-native';

import {setCurrentCall} from '@calls/state';
import {DefaultCurrentCall} from '@calls/types/calls';
import ServerUrlProvider from '@context/server';
import VoiceRecordingStore from '@store/voice_recording_store';
import {act, fireEvent, renderWithIntlAndTheme, waitFor} from '@test/intl-test-helper';

import VoiceMessageAction from './voice_message_action';

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

        for (let take = 1; take <= 2; take++) {
            fireEvent.press(screen.getByTestId('voice'));
            // eslint-disable-next-line no-await-in-loop
            await waitFor(() => expect(screen.getByTestId('voice.attach')).not.toBeDisabled());
            fireEvent.press(screen.getByTestId('voice.attach'));
            // eslint-disable-next-line no-await-in-loop
            await waitFor(() => expect(screen.queryByTestId('voice.attach')).toBeNull());
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
            fireEvent.press(screen.getByTestId('voice.cancel'));
        });

        await waitFor(() => expect(screen.queryByTestId('voice.cancel')).toBeNull());
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
        fireEvent.press(screen.getByTestId('voice.cancel'));
        await act(async () => {
            grantPermission({granted: true} as Awaited<ReturnType<typeof requestRecordingPermissionsAsync>>);
        });

        await waitFor(() => expect(screen.queryByTestId('voice.cancel')).toBeNull());
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

    it('should discard the recording when the app moves to the background', async () => {
        const props = getBaseProps();
        const screen = renderAction(props);

        fireEvent.press(screen.getByTestId('voice'));
        await waitFor(() => expect(recorder.record).toHaveBeenCalled());
        const listeners = jest.mocked(AppState.addEventListener).mock.calls;
        const onStateChange = listeners[listeners.length - 1][1];
        await act(async () => {
            onStateChange('background');
        });

        await waitFor(() => expect(screen.queryByTestId('voice.cancel')).toBeNull());
        expect(files.has(RECORDING_URI)).toBe(false);
        expect(props.onUploadFiles).not.toHaveBeenCalled();
    });

    it('should prevent attaching recordings shorter than one second', async () => {
        duration = 500;
        const props = getBaseProps();
        const screen = renderAction(props);

        fireEvent.press(screen.getByTestId('voice'));
        await waitFor(() => expect(recorder.record).toHaveBeenCalled());

        expect(screen.getByTestId('voice.attach')).toBeDisabled();
        fireEvent.press(screen.getByTestId('voice.attach'));
        expect(props.onUploadFiles).not.toHaveBeenCalled();
    });

    it('should allow attaching a recording stopped by the native duration limit', async () => {
        duration = 300000;
        const props = getBaseProps();
        const screen = renderAction(props);

        fireEvent.press(screen.getByTestId('voice'));
        await waitFor(() => expect(recorder.record).toHaveBeenCalledWith({forDuration: 300}));
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

        await waitFor(() => expect(screen.queryByTestId('voice.cancel')).toBeNull());
        expect(Alert.alert).toHaveBeenCalledWith('Voice message', expect.stringContaining('Unable to record'));
        expect(deletedUris).toContain(RECORDING_URI);
        expect(props.onUploadFiles).not.toHaveBeenCalled();
    });
});
