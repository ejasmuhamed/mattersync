// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import React from 'react';

import BrandIcon from '@components/brand_icon';
import {View as ViewConstants} from '@constants';

type Props = {
    theme: Theme;
}

const SystemAvatar: React.FC<Props> = () => {
    return (
        <BrandIcon
            size={ViewConstants.PROFILE_PICTURE_SIZE}
        />
    );
};

export default SystemAvatar;
