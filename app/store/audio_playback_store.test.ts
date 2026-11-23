// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import AudioPlaybackStore from './audio_playback_store';

describe('AudioPlaybackStore', () => {
    afterEach(() => {
        const playingId = AudioPlaybackStore.getPlayingId();
        if (playingId) {
            AudioPlaybackStore.stop(playingId);
        }
    });

    it('should hand playback to the most recent player', () => {
        AudioPlaybackStore.play('first');
        AudioPlaybackStore.play('second');

        expect(AudioPlaybackStore.getPlayingId()).toBe('second');
    });

    it('should not let a paused player clear the current player', () => {
        AudioPlaybackStore.play('first');
        AudioPlaybackStore.play('second');

        AudioPlaybackStore.stop('first');
        expect(AudioPlaybackStore.getPlayingId()).toBe('second');

        AudioPlaybackStore.stop('second');
        expect(AudioPlaybackStore.getPlayingId()).toBeNull();
    });
});
