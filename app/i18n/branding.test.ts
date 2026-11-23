// Copyright (c) 2026-present Bytsolv Digital Transformations Private Limited.
// See LICENSE.txt for license information.

import {brandTranslations} from './branding';

describe('Mattersync message branding', () => {
    it('should replace the app name in translated app messages without changing server or copyright attribution', () => {
        const original = {
            'mobile.calls.foreground_service.title': 'Mattermost',
            'mobile.calls_mic_error': 'Autorisez Mattermost à utiliser le microphone.',
            'settings.about.copyright': 'Copyright Mattermost, Inc.',
            'extension.no_servers.description': 'Connect to a Mattermost server.',
        };

        const branded = brandTranslations(original);

        expect(branded['mobile.calls.foreground_service.title']).toBe('Mattersync');
        expect(branded['mobile.calls_mic_error']).toBe('Autorisez Mattersync à utiliser le microphone.');
        expect(branded['settings.about.copyright']).toBe(original['settings.about.copyright']);
        expect(branded['extension.no_servers.description']).toBe(original['extension.no_servers.description']);
        expect(original['mobile.calls.foreground_service.title']).toBe('Mattermost');
    });

    it('should use branded English text when an app message has no translation', () => {
        const branded = brandTranslations({});

        expect(branded['mobile.calls.foreground_service.title']).toBe('Mattersync');
        expect(branded['rate.title']).toBe('Enjoying Mattersync?');
    });
});
