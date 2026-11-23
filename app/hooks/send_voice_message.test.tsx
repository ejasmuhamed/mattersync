// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import {act, renderHook} from '@testing-library/react-native';
import React from 'react';
import {IntlProvider} from 'react-intl';
import {Alert} from 'react-native';

import WebsocketManager from '@managers/websocket_manager';

import {useSendVoiceMessage} from './send_voice_message';

jest.mock('@context/server', () => ({
    useServerUrl: jest.fn().mockReturnValue('https://server.com'),
}));

type HookProps = Parameters<typeof useSendVoiceMessage>[0];

const VOICE = {clientId: 'voice-1', name: 'voice-message-1.m4a'} as FileInfo;

const wrapper = ({children}: {children: React.ReactNode}) => (
    <IntlProvider
        messages={{}}
        locale='en'
    >
        {children}
    </IntlProvider>
);

describe('useSendVoiceMessage', () => {
    let props: HookProps;

    beforeEach(() => {
        jest.clearAllMocks();
        jest.spyOn(WebsocketManager, 'isConnected').mockReturnValue(true);
        props = {
            channelId: 'channel-id',
            rootId: '',
            files: [],
            canSend: false,
            addFiles: jest.fn(),
            send: jest.fn(),
        };
    });

    const renderSendHook = () => renderHook((hookProps: HookProps) => useSendVoiceMessage(hookProps), {wrapper, initialProps: props});

    it('should send once the voice message finishes uploading', () => {
        const {result, rerender} = renderSendHook();

        act(() => result.current.sendVoiceMessage([VOICE]));
        expect(props.addFiles).toHaveBeenCalledWith([VOICE]);

        // Still uploading: no server id yet and sending is not allowed.
        rerender({...props, files: [VOICE]});
        expect(props.send).not.toHaveBeenCalled();

        rerender({...props, files: [{...VOICE, id: 'server-file-id'}], canSend: true});
        expect(props.send).toHaveBeenCalledTimes(1);

        // A later update must not send the message twice.
        rerender({...props, files: [{...VOICE, id: 'server-file-id'}], canSend: true});
        expect(props.send).toHaveBeenCalledTimes(1);
    });

    it('should keep the voice message in the draft without sending when offline', () => {
        jest.spyOn(WebsocketManager, 'isConnected').mockReturnValue(false);
        const {result, rerender} = renderSendHook();

        act(() => result.current.sendVoiceMessage([VOICE]));
        rerender({...props, files: [{...VOICE, id: 'server-file-id'}], canSend: true});

        expect(props.addFiles).toHaveBeenCalledWith([VOICE]);
        expect(Alert.alert).toHaveBeenCalledWith('Voice message not sent', expect.stringContaining("You're offline"));
        expect(props.send).not.toHaveBeenCalled();
    });

    it('should not send and explain when the upload fails', () => {
        const {result, rerender} = renderSendHook();

        act(() => result.current.sendVoiceMessage([VOICE]));
        rerender({...props, files: [{...VOICE, failed: true}], canSend: true});

        expect(Alert.alert).toHaveBeenCalledWith('Voice message not sent', expect.stringContaining("couldn't be uploaded"));
        expect(props.send).not.toHaveBeenCalled();
    });

    it('should cancel sending when the voice message is removed from the draft', () => {
        const {result, rerender} = renderSendHook();

        act(() => result.current.sendVoiceMessage([VOICE]));
        rerender({...props, files: [VOICE]});
        rerender({...props, files: []});
        rerender({...props, files: [{...VOICE, id: 'server-file-id'}], canSend: true});

        expect(props.send).not.toHaveBeenCalled();
    });
});
