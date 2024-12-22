import type {Config} from "tailwindcss";

const config: Config = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      keyframes: {
        'spin-once': {
          'from': { transform: 'rotate(0deg)' },
          'to': { transform: 'rotate(360deg)' }
        },
        fadeIn: {
          '0%': { opacity: '0', transform: 'translateY(-10px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' }
        }
      },
      animation: {
        'spin-once': 'spin-once 1s ease-in-out',
        'fadeIn': 'fadeIn 0.3s ease-out'
      }
    },
    colors: {
      primary: '#4F46E5',
      'primary-dark': '#4338CA',
    },
  },
  plugins: [require('daisyui')],
};
export default config;
