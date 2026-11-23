// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import VoiceRecordingStore from './voice_recording_store';

describe('VoiceRecordingStore', () => {
    afterEach(() => {
        VoiceRecordingStore.setRecording(false);
    });

    it('should not be recording initially', () => {
        expect(VoiceRecordingStore.isRecording()).toBe(false);
    });

    it('should notify subscribers only when the recording state changes', () => {
        const listener = jest.fn();
        const subscription = VoiceRecordingStore.observe().subscribe(listener);

        VoiceRecordingStore.setRecording(true);
        VoiceRecordingStore.setRecording(true);
        VoiceRecordingStore.setRecording(false);

        expect(listener).toHaveBeenCalledTimes(3);
        expect(listener.mock.calls).toEqual([[false], [true], [false]]);
        subscription.unsubscribe();
    });
});
