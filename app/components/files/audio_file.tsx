// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {defineMessages, useIntl} from 'react-intl';
import {
    View,
    Pressable,
    TouchableOpacity,
    Text,
    TouchableWithoutFeedback,
    type GestureResponderEvent,
} from 'react-native';
import Video, {type OnLoadData, type OnProgressData, type OnVideoErrorData, type VideoRef} from 'react-native-video';

import {storePreferredAudioPlaybackRate} from '@actions/app/global';
import {ITEM_HEIGHT} from '@components/slide_up_panel_item';
import {useTheme} from '@context/theme';
import {useDownloadFileAndPreview} from '@hooks/files';
import useInitialValue from '@hooks/initial_value';
import useThrottled from '@hooks/throttled';
import {getPreferredAudioPlaybackRate} from '@queries/app/global';
import {bottomSheet} from '@screens/navigation';
import AudioPlaybackStore from '@store/audio_playback_store';
import VoiceRecordingStore from '@store/voice_recording_store';
import {getToggledPlaybackRate, NORMAL_PLAYBACK_RATE, type PlaybackRate} from '@utils/audio_playback';
import {alertDownloadDocumentDisabled, alertOnlyPDFSupported} from '@utils/document';
import {generateId} from '@utils/general';
import {bottomSheetSnapPoint} from '@utils/helpers';
import {logDebug} from '@utils/log';
import {changeOpacity, makeStyleSheetFromTheme} from '@utils/theme';
import {typography} from '@utils/typography';

import CompassIcon from '../compass_icon';
import FormattedText from '../formatted_text';
import ProgressBar from '../progress_bar';

import PlaybackSpeedSheet from './playback_speed_sheet';

const messages = defineMessages({
    speed: {id: 'audio.playback_speed', defaultMessage: 'Playback speed'},
    speedHint: {id: 'audio.playback_speed_hint', defaultMessage: 'Tap to switch speed. Long press to choose a speed.'},
});

const SPEED_HIT_SLOP = {top: 8, bottom: 8, left: 4, right: 4};

// The speed sheet holds a header, the slider and the speed labels: about three option rows tall.
const SPEED_SHEET_ROWS = 3;

type Props = {
    file: FileInfo;
    canDownloadFiles: boolean;
    enableSecureFilePreview: boolean;
}

const getStyleSheet = makeStyleSheetFromTheme((theme: Theme) => ({
    audioFileWrapper: {
        position: 'relative',
        borderColor: changeOpacity(theme.centerChannelColor, 0.2),
        borderRadius: 4,
        borderWidth: 1,
        padding: 12,
        overflow: 'hidden',
        flexDirection: 'row',
        gap: 12,
        alignItems: 'center',
    },
    speedButton: {
        alignItems: 'center',
        backgroundColor: changeOpacity(theme.buttonBg, 0.08),
        borderRadius: 12,
        minWidth: 48,
        paddingHorizontal: 8,
        paddingVertical: 4,
    },
    speedButtonPressed: {
        opacity: 0.72,
    },
    speedText: {
        color: theme.buttonBg,
        ...typography('Body', 75, 'SemiBold'),
    },
    playButton: {
        flexDirection: 'column',
        justifyContent: 'center',
        alignItems: 'center',
        backgroundColor: changeOpacity(theme.buttonBg, 0.12),
        borderRadius: 100,
        width: 40,
        height: 40,
    },
    playIcon: {
        color: theme.buttonBg,
    },
    downloadIcon: {
        color: changeOpacity(theme.centerChannelColor, 0.56),
    },
    progressBar: {
        flex: 1,
    },
    timerText: {
        color: theme.centerChannelColor,
        ...typography('Body', 75, 'SemiBold'),
    },
}));

const AudioFile = ({file, canDownloadFiles, enableSecureFilePreview}: Props) => {
    const intl = useIntl();
    const theme = useTheme();
    const style = getStyleSheet(theme);
    const [hasPaused, setHasPaused] = useState<boolean>(true);
    const [hasError, setHasError] = useState<boolean>(false);
    const [hasEnded, setHasEnded] = useState<boolean>(false);
    const [progress, setProgress] = useState<number>(0);
    const [timeInMinutes, setTimeInMinutes] = useState<string>('0:00');
    const [duration, setDuration] = useState<number>(0);
    const videoRef = useRef<VideoRef>(null);
    const [playbackRate, setPlaybackRate] = useState<PlaybackRate>(1);
    const speedText = `${playbackRate}×`;

    // While a voice message records, react-native-video must not reset the iOS audio session to playback-only, or the microphone records silence.
    const [isRecordingVoiceMessage, setIsRecordingVoiceMessage] = useState(VoiceRecordingStore.isRecording());
    useEffect(() => {
        const subscription = VoiceRecordingStore.observe().subscribe(setIsRecordingVoiceMessage);
        return () => subscription.unsubscribe();
    }, []);

    // Only one audio message plays at a time: pause this player when another one starts.
    const playerId = useInitialValue(generateId);
    useEffect(() => {
        const subscription = AudioPlaybackStore.observe().subscribe((playingId) => {
            if (playingId !== playerId) {
                setHasPaused(true);
            }
        });
        return () => {
            subscription.unsubscribe();
            AudioPlaybackStore.stop(playerId);
        };
    }, [playerId]);

    useEffect(() => {
        if (hasEnded) {
            const timer = setTimeout(() => {
                setHasPaused(true);
                setProgress(0);
                setHasEnded(false);
                AudioPlaybackStore.stop(playerId);
            }, 100);

            return () => clearTimeout(timer);
        }

        return () => null;
    }, [hasEnded, playerId]);

    const source = useMemo(() => ({uri: file.uri}), [file.uri]);

    const {toggleDownloadAndPreview} = useDownloadFileAndPreview(enableSecureFilePreview);

    const onPlayPress = () => {
        if (hasPaused) {
            // Claim playback first so the store pauses every other player, not this one.
            AudioPlaybackStore.play(playerId);
        } else {
            AudioPlaybackStore.stop(playerId);
        }
        setHasPaused(!hasPaused);
    };

    const onDownloadPress = useCallback(async () => {
        if (enableSecureFilePreview) {
            alertOnlyPDFSupported(intl);
            return;
        }

        if (!canDownloadFiles) {
            alertDownloadDocumentDisabled(intl);
            return;
        }

        toggleDownloadAndPreview(file);
    }, [enableSecureFilePreview, canDownloadFiles, toggleDownloadAndPreview, file, intl]);

    const loadTimeInMinutes = useCallback((timeInSeconds: number) => {
        const minutes = Math.floor(timeInSeconds / 60);
        const seconds = Math.floor(timeInSeconds % 60);
        setTimeInMinutes(`${minutes}:${seconds.toString().padStart(2, '0')}`);
    }, []);

    const onLoad = useCallback((loadData: OnLoadData) => {
        loadTimeInMinutes(loadData.duration);
        setDuration(loadData.duration);
    }, [loadTimeInMinutes]);

    const throttledLoadTimeOneSecond = useThrottled(loadTimeInMinutes, 1000);
    const throttledLoadTime100Milliseconds = useThrottled(loadTimeInMinutes, 100);

    const onProgress = useCallback((progressData: OnProgressData) => {
        if (hasPaused) {
            return;
        }
        const {currentTime, playableDuration} = progressData;
        setProgress(currentTime / playableDuration);
        throttledLoadTimeOneSecond(currentTime);
    }, [hasPaused, throttledLoadTimeOneSecond]);

    const onEnd = useCallback(() => {
        if (videoRef.current) {
            videoRef.current.seek(0);
        }
        setHasEnded(true);
    }, []);

    const onError = useCallback(({error}: OnVideoErrorData) => {
        setHasError(true);
        logDebug((error && typeof error === 'object' && 'errorString' in error) ? error.errorString : error);
    }, []);

    const onSeek = useCallback((seekPosition: number) => {
        if (videoRef.current && duration > 0) {
            const newTime = seekPosition * duration;
            videoRef.current.seek(newTime);
            setProgress(seekPosition);
            throttledLoadTime100Milliseconds(newTime);
        }
    }, [duration, throttledLoadTime100Milliseconds]);

    const onSpeedPress = useCallback(async () => {
        const preferred = await getPreferredAudioPlaybackRate();
        setPlaybackRate((current) => getToggledPlaybackRate(current, preferred));
    }, []);

    const onSpeedLongPress = useCallback(() => {
        // Applies live while the sheet stays open, so the change can be heard while dragging.
        const onChangeRate = (rate: PlaybackRate) => {
            setPlaybackRate(rate);

            // A faster speed also becomes what a tap switches to; normal speed is never a tap target.
            if (rate !== NORMAL_PLAYBACK_RATE) {
                storePreferredAudioPlaybackRate(rate);
            }
        };

        const renderContent = () => (
            <PlaybackSpeedSheet
                initialRate={playbackRate}
                onChange={onChangeRate}
            />
        );

        bottomSheet(renderContent, [1, bottomSheetSnapPoint(SPEED_SHEET_ROWS, ITEM_HEIGHT)]);
    }, [playbackRate]);

    const onAudioFocusChanged = useCallback(({hasAudioFocus}: {hasAudioFocus: boolean}) => {
        if (!hasAudioFocus) {
            setHasPaused(true);
        }
    }, []);

    const stopPropagation = useCallback((e: GestureResponderEvent) => {
        e.stopPropagation();
    }, []);

    if (hasError) {
        return (
            <FormattedText
                id={'audio.loading_error'}
                defaultMessage={'Error loading audio.'}
            />
        );
    }

    return (
        <TouchableWithoutFeedback
            onPress={stopPropagation}
        >
            <View style={style.audioFileWrapper}>
                <TouchableOpacity
                    style={style.playButton}
                    onPress={onPlayPress}
                >
                    <CompassIcon
                        name={hasPaused ? 'play' : 'pause'}
                        size={24}
                        style={style.playIcon}
                    />
                </TouchableOpacity>

                <Video
                    ref={videoRef}
                    source={source}
                    paused={hasPaused}
                    onLoad={onLoad}
                    onProgress={onProgress}
                    onError={onError}
                    onEnd={onEnd}
                    onAudioFocusChanged={onAudioFocusChanged}
                    disableAudioSessionManagement={isRecordingVoiceMessage}
                    rate={playbackRate}
                />

                <View style={style.progressBar}>
                    <ProgressBar
                        progress={progress}
                        color={theme.buttonBg}
                        withCursor={true}
                        onSeek={onSeek}
                    />
                </View>

                <Text style={style.timerText}>{timeInMinutes}</Text>

                <Pressable
                    testID='audio_file.speed'
                    accessibilityRole='button'
                    accessibilityLabel={intl.formatMessage(messages.speed)}
                    accessibilityValue={{text: speedText}}
                    accessibilityHint={intl.formatMessage(messages.speedHint)}
                    onPress={onSpeedPress}
                    onLongPress={onSpeedLongPress}
                    hitSlop={SPEED_HIT_SLOP}
                    style={({pressed}) => [style.speedButton, pressed && style.speedButtonPressed]}
                >
                    <Text style={style.speedText}>{speedText}</Text>
                </Pressable>

                {!enableSecureFilePreview &&
                <TouchableOpacity
                    onPress={onDownloadPress}
                >
                    <CompassIcon
                        name='download-outline'
                        size={24}
                        style={style.downloadIcon}
                    />
                </TouchableOpacity>
                }
            </View>
        </TouchableWithoutFeedback>
    );
};

export default AudioFile;
