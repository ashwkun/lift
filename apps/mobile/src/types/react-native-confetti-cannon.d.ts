declare module 'react-native-confetti-cannon' {
  import * as React from 'react';
  import { ViewProps } from 'react-native';

  export interface ConfettiCannonProps extends ViewProps {
    count?: number;
    origin?: { x: number; y: number };
    explosionSpeed?: number;
    fallSpeed?: number;
    colors?: string[];
    fadeOut?: boolean;
    autoStart?: boolean;
    autoStartDelay?: number;
  }

  export default class ConfettiCannon extends React.Component<ConfettiCannonProps> {
    start(): void;
    stop(): void;
  }
}
