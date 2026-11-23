// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

export const PLAYBACK_RATES = [1, 1.25, 1.5, 1.75, 2] as const;
export type PlaybackRate = typeof PLAYBACK_RATES[number];

export const NORMAL_PLAYBACK_RATE: PlaybackRate = 1;

/** The speed a tap switches to until the user picks another one from the speed menu. */
export const DEFAULT_PREFERRED_PLAYBACK_RATE: PlaybackRate = 2;

export function isPlaybackRate(value: unknown): value is PlaybackRate {
    return PLAYBACK_RATES.includes(value as PlaybackRate);
}

const MIN_RATE = PLAYBACK_RATES[0];
const MAX_RATE = PLAYBACK_RATES[PLAYBACK_RATES.length - 1];

/**
 * Maps a slider position (0 to 1) to the nearest supported playback rate, so the slider snaps.
 */
export function getPlaybackRateFromPosition(position: number): PlaybackRate {
    const target = MIN_RATE + (position * (MAX_RATE - MIN_RATE));
    return PLAYBACK_RATES.reduce<PlaybackRate>((nearest, rate) => (
        Math.abs(rate - target) < Math.abs(nearest - target) ? rate : nearest
    ), MIN_RATE);
}

/**
 * Maps a playback rate to its slider position (0 to 1).
 */
export function getPositionFromPlaybackRate(rate: PlaybackRate): number {
    return (rate - MIN_RATE) / (MAX_RATE - MIN_RATE);
}

/**
 * A tap toggles between normal speed and the preferred speed.
 */
export function getToggledPlaybackRate(current: PlaybackRate, preferred: PlaybackRate): PlaybackRate {
    return current === NORMAL_PLAYBACK_RATE ? preferred : NORMAL_PLAYBACK_RATE;
}
