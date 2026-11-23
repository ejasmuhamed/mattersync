// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import {getPlaybackRateFromPosition, getPositionFromPlaybackRate, getToggledPlaybackRate, isPlaybackRate} from './audio_playback';

describe('playback rate slider', () => {
    it('should snap a slider position to the nearest playback rate', () => {
        expect(getPlaybackRateFromPosition(0)).toBe(1);
        expect(getPlaybackRateFromPosition(0.1)).toBe(1);
        expect(getPlaybackRateFromPosition(0.2)).toBe(1.25);
        expect(getPlaybackRateFromPosition(0.55)).toBe(1.5);
        expect(getPlaybackRateFromPosition(0.8)).toBe(1.75);
        expect(getPlaybackRateFromPosition(1)).toBe(2);
    });

    it('should place each playback rate at its slider position', () => {
        expect(getPositionFromPlaybackRate(1)).toBe(0);
        expect(getPositionFromPlaybackRate(1.5)).toBe(0.5);
        expect(getPositionFromPlaybackRate(2)).toBe(1);
    });
});

describe('getToggledPlaybackRate', () => {
    it('should switch from normal speed to the preferred speed', () => {
        expect(getToggledPlaybackRate(1, 2)).toBe(2);
        expect(getToggledPlaybackRate(1, 1.5)).toBe(1.5);
    });

    it('should switch back to normal speed from any faster speed', () => {
        expect(getToggledPlaybackRate(1.25, 2)).toBe(1);
    });
});

describe('isPlaybackRate', () => {
    it('should only accept supported playback rates', () => {
        expect(isPlaybackRate(1.75)).toBe(true);
        expect(isPlaybackRate(3)).toBe(false);
        expect(isPlaybackRate('2')).toBe(false);
        expect(isPlaybackRate(undefined)).toBe(false);
    });
});
