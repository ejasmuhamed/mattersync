// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import React, {useCallback, useState} from 'react';
import {Pressable, Text, View} from 'react-native';

import FormattedText from '@components/formatted_text';
import ProgressBar from '@components/progress_bar';
import {useTheme} from '@context/theme';
import {
    getPlaybackRateFromPosition,
    getPositionFromPlaybackRate,
    PLAYBACK_RATES,
    type PlaybackRate,
} from '@utils/audio_playback';
import {changeOpacity, makeStyleSheetFromTheme} from '@utils/theme';
import {typography} from '@utils/typography';

type Props = {
    initialRate: PlaybackRate;
    onChange: (rate: PlaybackRate) => void;
};

const LABEL_HIT_SLOP = {top: 8, bottom: 8};

const getStyleSheet = makeStyleSheetFromTheme((theme: Theme) => ({
    container: {
        paddingHorizontal: 20,
        paddingTop: 8,
        gap: 8,
    },
    header: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
    },
    title: {
        color: theme.centerChannelColor,
        ...typography('Heading', 300, 'SemiBold'),
    },
    value: {
        color: theme.buttonBg,
        ...typography('Heading', 300, 'SemiBold'),
    },

    // Each label is centered in a fifth of the width, so insetting the slider by half a column
    // on each side puts every snap point directly above its label.
    slider: {
        marginHorizontal: '10%',
    },
    labels: {
        flexDirection: 'row',
    },
    labelButton: {
        flex: 1,
        alignItems: 'center',
    },
    labelPressed: {
        opacity: 0.72,
    },
    label: {
        color: changeOpacity(theme.centerChannelColor, 0.64),
        ...typography('Body', 100),
    },
    labelSelected: {
        color: theme.buttonBg,
        ...typography('Body', 100, 'SemiBold'),
    },
}));

type LabelProps = {
    rate: PlaybackRate;
    selected: boolean;
    onPress: (rate: PlaybackRate) => void;
};

const SpeedLabel = ({rate, selected, onPress}: LabelProps) => {
    const theme = useTheme();
    const style = getStyleSheet(theme);
    const handlePress = useCallback(() => onPress(rate), [onPress, rate]);

    return (
        <Pressable
            testID={`audio_file.speed.option.${rate}`}
            accessibilityRole='button'
            accessibilityState={{selected}}
            hitSlop={LABEL_HIT_SLOP}
            onPress={handlePress}
            style={({pressed}) => [style.labelButton, pressed && style.labelPressed]}
        >
            <Text style={selected ? style.labelSelected : style.label}>{`${rate}×`}</Text>
        </Pressable>
    );
};

const PlaybackSpeedSheet = ({initialRate, onChange}: Props) => {
    const theme = useTheme();
    const style = getStyleSheet(theme);
    const [rate, setRate] = useState(initialRate);

    // The slider reports every drag movement; only act when it snaps to a different rate.
    const selectRate = useCallback((next: PlaybackRate) => {
        if (next !== rate) {
            setRate(next);
            onChange(next);
        }
    }, [onChange, rate]);

    const onSeek = useCallback((position: number) => {
        selectRate(getPlaybackRateFromPosition(position));
    }, [selectRate]);

    return (
        <View
            testID='audio_file.speed.options'
            style={style.container}
        >
            <View style={style.header}>
                <FormattedText
                    id='audio.playback_speed'
                    defaultMessage='Playback speed'
                    style={style.title}
                />
                <Text style={style.value}>{`${rate}×`}</Text>
            </View>
            <View style={style.slider}>
                <ProgressBar
                    progress={getPositionFromPlaybackRate(rate)}
                    color={theme.buttonBg}
                    withCursor={true}
                    onSeek={onSeek}
                />
            </View>
            <View style={style.labels}>
                {PLAYBACK_RATES.map((option) => (
                    <SpeedLabel
                        key={option}
                        rate={option}
                        selected={option === rate}
                        onPress={selectRate}
                    />
                ))}
            </View>
        </View>
    );
};

export default PlaybackSpeedSheet;
