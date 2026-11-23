// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import {useCallback, useEffect, useRef, useState} from 'react';
import {defineMessages, useIntl} from 'react-intl';
import {Alert} from 'react-native';

import {useServerUrl} from '@context/server';
import WebsocketManager from '@managers/websocket_manager';
import {logDebug} from '@utils/log';

const messages = defineMessages({
    title: {id: 'voice_message.send_alert_title', defaultMessage: 'Voice message not sent'},
    offline: {
        id: 'voice_message.send_offline',
        defaultMessage: "You're offline, so your voice message wasn't sent. It's saved in the message box. When you're back online, tap retry on it, then send.",
    },
    failed: {
        id: 'voice_message.send_failed',
        defaultMessage: "Your voice message couldn't be uploaded, so it wasn't sent. It's saved in the message box. Tap retry on it, then send.",
    },
});

type Args = {
    channelId: string;
    rootId: string;
    files: FileInfo[];
    canSend: boolean;
    addFiles: (files: FileInfo[]) => void;
    send: () => unknown;
};

/**
 * Sends a voice message as soon as its upload finishes.
 *
 * The recording goes through the normal draft upload, so a failed upload keeps it in the message box
 * with the usual retry button. Nothing is posted when the device is offline or the upload fails.
 */
export const useSendVoiceMessage = ({channelId, rootId, files, canSend, addFiles, send}: Args) => {
    const intl = useIntl();
    const serverUrl = useServerUrl();
    const [pendingClientId, setPendingClientId] = useState<string>();

    // The draft only lists the file once it has been stored, so "missing" means removed only after it was seen.
    const seenInDraft = useRef(false);

    const notify = useCallback((message: keyof typeof messages) => {
        Alert.alert(intl.formatMessage(messages.title), intl.formatMessage(messages[message]));
    }, [intl]);

    // Never carry a pending send over to another channel or thread.
    useEffect(() => {
        setPendingClientId(undefined);
    }, [serverUrl, channelId, rootId]);

    const sendVoiceMessage = useCallback((voiceFiles: FileInfo[]) => {
        addFiles(voiceFiles);
        if (!WebsocketManager.isConnected(serverUrl)) {
            logDebug('useSendVoiceMessage: offline, keeping the voice message in the draft');
            notify('offline');
            return;
        }
        seenInDraft.current = false;
        setPendingClientId(voiceFiles[0]?.clientId);
    }, [addFiles, notify, serverUrl]);

    useEffect(() => {
        if (!pendingClientId) {
            return;
        }

        const file = files.find((f) => f.clientId === pendingClientId);
        if (!file) {
            if (seenInDraft.current) {
                logDebug('useSendVoiceMessage: voice message removed from the draft before sending');
                setPendingClientId(undefined);
            }
            return;
        }
        seenInDraft.current = true;

        if (file.failed) {
            setPendingClientId(undefined);
            notify('failed');
            return;
        }

        if (file.id && canSend) {
            setPendingClientId(undefined);
            send();
        }
    }, [files, canSend, pendingClientId, send, notify]);

    return {sendVoiceMessage, isSendingVoiceMessage: Boolean(pendingClientId)};
};
