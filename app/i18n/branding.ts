// Copyright (c) 2026-present Bytsolv Digital Transformations Private Limited.
// See LICENSE.txt for license information.

import Brand from '@assets/branding/brand.json';
import en from '@assets/i18n/en.json';

const english: Record<string, string> = en;

// Rebrand only app-owned messages. Server/product references and legal attribution
// remain intact, and upstream translation files stay compatible with Weblate.
export function brandTranslations(messages: Record<string, string>) {
    const branded = {...messages};
    for (const id of Brand.messageIds) {
        const value = messages[id] || english[id];
        if (value) {
            branded[id] = value.replace(/Mattermost/g, Brand.name);
        }
    }
    return branded;
}
