// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import {BehaviorSubject} from 'rxjs';

/**
 * Tracks whether a voice message is being recorded.
 *
 * While it is, audio players stop managing the iOS audio session: react-native-video resets the
 * session to playback-only whenever a player mounts or changes, which silences the microphone and
 * produces an empty recording.
 */
class VoiceRecordingStoreSingleton {
    private subject = new BehaviorSubject<boolean>(false);

    setRecording = (recording: boolean) => {
        if (this.subject.value !== recording) {
            this.subject.next(recording);
        }
    };

    observe() {
        return this.subject.asObservable();
    }

    isRecording() {
        return this.subject.value;
    }
}

const VoiceRecordingStore = new VoiceRecordingStoreSingleton();
export default VoiceRecordingStore;
