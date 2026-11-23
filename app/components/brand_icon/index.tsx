// Copyright (c) 2026-present Bytsolv Digital Transformations Private Limited.
// See LICENSE.txt for license information.

import React from 'react';
import Svg, {Polygon, Rect} from 'react-native-svg';

import Brand from '@assets/branding/brand.json';

type Props = {
    size: number;
    testID?: string;
};

// Geometry matches assets/base/branding/mark.svg, the source of the native icons.
export default function BrandIcon({size, testID}: Props) {
    return (
        <Svg
            width={size}
            height={size}
            viewBox='0 0 256 256'
            testID={testID}
            accessibilityLabel={Brand.name}
        >
            <Rect
                width={256}
                height={256}
                rx={52}
                fill={Brand.background}
            />
            <Rect
                x={44}
                y={48}
                width={142}
                height={90}
                rx={26}
                fill={Brand.foreground}
            />
            <Polygon
                points='68,128 68,158 104,128'
                fill={Brand.foreground}
            />
            <Rect
                x={84}
                y={112}
                width={132}
                height={88}
                rx={26}
                fill={Brand.accent}
                stroke={Brand.background}
                strokeWidth={8}
            />
            <Polygon
                points='160,192 190,216 190,184'
                fill={Brand.accent}
            />
            <Rect
                x={116}
                y={145}
                width={10}
                height={22}
                rx={5}
                fill={Brand.background}
            />
            <Rect
                x={141}
                y={136}
                width={10}
                height={40}
                rx={5}
                fill={Brand.background}
            />
            <Rect
                x={166}
                y={145}
                width={10}
                height={22}
                rx={5}
                fill={Brand.background}
            />
        </Svg>
    );
}
