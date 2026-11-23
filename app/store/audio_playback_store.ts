// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import {BehaviorSubject} from 'rxjs';

/**
 * Tracks which in-app audio player is playing, so only one audio message plays at a time.
 * A player claims playback when it starts; every other player pauses when the claim moves away from it.
 */
class AudioPlaybackStoreSingleton {
    private subject = new BehaviorSubject<string | null>(null);

    play = (playerId: string) => {
        if (this.subject.value !== playerId) {
            this.subject.next(playerId);
        }
    };

    /**
     * Releases playback only if this player still owns it, so a player that was
     * already paused by another one cannot clear the newer player's claim.
     */
    stop = (playerId: string) => {
        if (this.subject.value === playerId) {
            this.subject.next(null);
        }
    };

    observe() {
        return this.subject.asObservable();
    }

    getPlayingId() {
        return this.subject.value;
    }
}

const AudioPlaybackStore = new AudioPlaybackStoreSingleton();
export default AudioPlaybackStore;
