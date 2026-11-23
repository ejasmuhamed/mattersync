// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import React, {useEffect} from 'react';
import {defineMessages, useIntl} from 'react-intl';
import {Modal, Pressable, Text, View} from 'react-native';
import Animated, {cancelAnimation, useAnimatedStyle, useSharedValue, withRepeat, withTiming} from 'react-native-reanimated';
import {useSafeAreaInsets} from 'react-native-safe-area-context';

import CompassIcon, {type CompassIconName} from '@components/compass_icon';
import {useTheme} from '@context/theme';
import {changeOpacity, makeStyleSheetFromTheme} from '@utils/theme';
import {typography} from '@utils/typography';

export type RecordingPhase = 'closed' | 'preparing' | 'recording' | 'paused' | 'ready' | 'stopping';

const messages = defineMessages({
    recording: {id: 'voice_message.recording', defaultMessage: 'Recording'},
    paused: {id: 'voice_message.paused', defaultMessage: 'Paused'},
    discard: {id: 'voice_message.discard', defaultMessage: 'Delete recording'},
    pause: {id: 'voice_message.pause', defaultMessage: 'Pause recording'},
    resume: {id: 'voice_message.resume', defaultMessage: 'Resume recording'},
    attach: {id: 'voice_message.attach', defaultMessage: 'Add to message'},
    send: {id: 'voice_message.send', defaultMessage: 'Send voice message'},
});

const BAR_BUTTON_SIZE = 40;
const DOT_PULSE = {duration: 600};

const getStyleSheet = makeStyleSheetFromTheme((theme: Theme) => ({
    overlay: {
        flex: 1,
        justifyContent: 'flex-end',
        backgroundColor: changeOpacity(theme.centerChannelColor, 0.16),
    },
    bar: {
        backgroundColor: theme.centerChannelBg,
        borderTopLeftRadius: 12,
        borderTopRightRadius: 12,
        borderTopWidth: 1,
        borderColor: changeOpacity(theme.centerChannelColor, 0.08),
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        paddingHorizontal: 12,
        paddingTop: 12,
    },
    status: {
        flex: 1,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        paddingHorizontal: 4,
    },
    dot: {
        width: 10,
        height: 10,
        borderRadius: 5,
        backgroundColor: theme.dndIndicator,
    },
    dotIdle: {
        backgroundColor: changeOpacity(theme.centerChannelColor, 0.32),
    },
    timer: {
        color: theme.centerChannelColor,
        ...typography('Body', 200, 'SemiBold'),
    },
    statusLabel: {
        color: changeOpacity(theme.centerChannelColor, 0.64),
        ...typography('Body', 100),
    },
    barButton: {
        alignItems: 'center',
        justifyContent: 'center',
        width: BAR_BUTTON_SIZE,
        height: BAR_BUTTON_SIZE,
        borderRadius: BAR_BUTTON_SIZE / 2,
    },
    secondaryButton: {
        backgroundColor: changeOpacity(theme.centerChannelColor, 0.08),
    },
    primaryButton: {
        backgroundColor: theme.buttonBg,
    },
    buttonDisabled: {
        opacity: 0.4,
    },
    pressed: {
        opacity: 0.64,
    },
}));

type BarButtonProps = {
    testID: string;
    icon: CompassIconName;
    label: string;
    primary?: boolean;
    disabled?: boolean;
    onPress: () => void;
};

const BarButton = ({testID, icon, label, primary, disabled, onPress}: BarButtonProps) => {
    const theme = useTheme();
    const style = getStyleSheet(theme);

    return (
        <Pressable
            testID={testID}
            accessibilityRole='button'
            accessibilityLabel={label}
            accessibilityState={{disabled}}
            disabled={disabled}
            onPress={onPress}
            style={({pressed}) => [
                style.barButton,
                primary ? style.primaryButton : style.secondaryButton,
                disabled && style.buttonDisabled,
                pressed && style.pressed,
            ]}
        >
            <CompassIcon
                name={icon}
                size={22}
                color={primary ? theme.buttonColor : changeOpacity(theme.centerChannelColor, 0.72)}
            />
        </Pressable>
    );
};

type Props = {
    testID: string;
    phase: RecordingPhase;
    timer: string;

    /** Whether the take can be sent straight away; otherwise it can only be added to the message. */
    canSend: boolean;
    onDiscard: () => void;
    onPause: () => void;
    onResume: () => void;
    onAttach: () => void;
    onSend: () => void;
};

/**
 * The bar that replaces the message box while a voice message records.
 */
const VoiceRecordingBar = ({testID, phase, timer, canSend, onDiscard, onPause, onResume, onAttach, onSend}: Props) => {
    const theme = useTheme();
    const style = getStyleSheet(theme);
    const intl = useIntl();
    const {bottom} = useSafeAreaInsets();
    const isActive = phase === 'recording' || phase === 'paused' || phase === 'ready';
    const isPaused = phase === 'paused' || phase === 'ready';

    const dotOpacity = useSharedValue(1);
    const dotStyle = useAnimatedStyle(() => ({opacity: dotOpacity.value}));
    useEffect(() => {
        if (phase === 'recording') {
            dotOpacity.value = withRepeat(withTiming(0.2, DOT_PULSE), -1, true);
        } else {
            cancelAnimation(dotOpacity);
            dotOpacity.value = withTiming(1, DOT_PULSE);
        }
    }, [phase, dotOpacity]);

    return (
        <Modal
            visible={phase !== 'closed'}
            transparent={true}
            animationType='fade'
            onRequestClose={onDiscard}
        >
            <View style={style.overlay}>
                <View
                    testID={`${testID}.bar`}
                    style={[style.bar, {paddingBottom: bottom + 12}]}
                    accessibilityViewIsModal={true}
                >
                    <BarButton
                        testID={`${testID}.discard`}
                        icon='trash-can-outline'
                        label={intl.formatMessage(messages.discard)}
                        disabled={phase === 'stopping'}
                        onPress={onDiscard}
                    />
                    <View
                        style={style.status}
                        accessible={true}
                        accessibilityLiveRegion='polite'
                    >
                        {/* Gray until the microphone is really capturing, so red means "speak now". */}
                        <Animated.View
                            testID={`${testID}.dot`}
                            style={[style.dot, phase !== 'recording' && style.dotIdle, dotStyle]}
                        />
                        <Text
                            testID={`${testID}.timer`}
                            style={style.timer}
                        >
                            {timer}
                        </Text>
                        {isActive && (
                            <Text style={style.statusLabel}>
                                {intl.formatMessage(isPaused ? messages.paused : messages.recording)}
                            </Text>
                        )}
                    </View>
                    {phase === 'paused' ? (
                        <BarButton
                            testID={`${testID}.resume`}
                            icon='microphone'
                            label={intl.formatMessage(messages.resume)}
                            onPress={onResume}
                        />
                    ) : (
                        <BarButton
                            testID={`${testID}.pause`}
                            icon='pause'
                            label={intl.formatMessage(messages.pause)}
                            disabled={phase !== 'recording'}
                            onPress={onPause}
                        />
                    )}
                    <BarButton
                        testID={`${testID}.attach`}
                        icon='paperclip'
                        label={intl.formatMessage(messages.attach)}
                        primary={!canSend}
                        disabled={!isActive}
                        onPress={onAttach}
                    />
                    {canSend && (
                        <BarButton
                            testID={`${testID}.send`}
                            icon='send'
                            label={intl.formatMessage(messages.send)}
                            primary={true}
                            disabled={!isActive}
                            onPress={onSend}
                        />
                    )}
                </View>
            </View>
        </Modal>
    );
};

export default VoiceRecordingBar;
