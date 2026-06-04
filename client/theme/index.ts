import { Dimensions, PixelRatio, Platform } from 'react-native';

const { width, height } = Dimensions.get('window');

// Responsive scale based on 375px base width
export const scale = (size: number) => (width / 375) * size;
export const fs = (size: number) =>
  Math.round(size * PixelRatio.getFontScale() * (width / 375));

export const colors = {
  primary: '#1A73E8',
  primaryLight: '#E8F0FE',
  primaryDark: '#1557B0',
  success: '#1E8F4E',
  successLight: '#E6F4EA',
  error: '#D32F2F',
  errorLight: '#FDECEA',
  warning: '#F9A825',
  warningLight: '#FFF8E1',
  white: '#FFFFFF',
  background: '#F5F7FA',
  surface: '#FFFFFF',
  border: '#E0E0E0',
  textPrimary: '#1A1A2E',
  textSecondary: '#5F6368',
  textHint: '#9AA0A6',
  overlay: 'rgba(0,0,0,0.5)',
  cameraOverlay: 'rgba(0,0,0,0.7)',
};

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
};

export const radius = {
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  full: 9999,
};

export const shadow = Platform.select({
  ios: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
  },
  android: {
    elevation: 3,
  },
});

export const typography = {
  h1: { fontSize: fs(24), fontWeight: '700' as const, color: colors.textPrimary },
  h2: { fontSize: fs(20), fontWeight: '700' as const, color: colors.textPrimary },
  h3: { fontSize: fs(17), fontWeight: '600' as const, color: colors.textPrimary },
  body: { fontSize: fs(15), fontWeight: '400' as const, color: colors.textPrimary },
  bodyBold: { fontSize: fs(15), fontWeight: '600' as const, color: colors.textPrimary },
  small: { fontSize: fs(13), fontWeight: '400' as const, color: colors.textSecondary },
  tiny: { fontSize: fs(11), fontWeight: '400' as const, color: colors.textHint },
  label: { fontSize: fs(13), fontWeight: '500' as const, color: colors.textSecondary },
};

export const hitSlop = { top: 12, bottom: 12, left: 12, right: 12 };

export const screenWidth = width;
export const screenHeight = height;

export default {
  scale,
  fs,
  colors,
  spacing,
  radius,
  shadow,
  typography,
  hitSlop,
  screenWidth,
  screenHeight,
};
