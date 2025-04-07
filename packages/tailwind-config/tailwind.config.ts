import type { Config } from 'tailwindcss/types/config';

export default {
  theme: {
    extend: {
      colors: {
        primary: {
          DEFAULT: '#F9D84E', // Bright yellow from the logo
          50: '#FFFDF5',
          100: '#FEF9E0',
          200: '#FCF0BC',
          300: '#FBE897',
          400: '#FADF73',
          500: '#F9D84E', // Main yellow color
          600: '#E7C31E',
          700: '#C19E15',
          800: '#9C7F11',
          900: '#77600D',
        },
      },
    },
  },
  plugins: [],
} as Omit<Config, 'content'>;
