import type { Config } from 'tailwindcss';

const config: Config = {
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        surface: {
          900: '#0b0f17',
          800: '#111827',
          700: '#1a2333',
          600: '#243044',
        },
      },
    },
  },
  plugins: [],
};

export default config;
