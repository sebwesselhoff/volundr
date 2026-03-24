import type { Config } from 'tailwindcss';

const config: Config = {
  darkMode: 'class',
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['var(--font-montserrat)', 'Montserrat', 'sans-serif'],
      },
      colors: {
        bg: 'var(--vldr-bg)',
        surface: 'var(--vldr-surface)',
        'surface-alt': 'var(--vldr-surface-alt)',
        border: 'var(--vldr-border)',
        text: 'var(--vldr-text)',
        'text-secondary': 'var(--vldr-text-secondary)',
        accent: 'var(--vldr-accent)',
        success: 'var(--vldr-success)',
        warning: 'var(--vldr-warning)',
        error: 'var(--vldr-error)',
        info: 'var(--vldr-info)',
      },
    },
  },
  plugins: [],
};

export default config;
