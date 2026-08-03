/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./src/renderer/index.html",
    "./src/renderer/src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        brand: {
          50: '#f5f7fa',
          100: '#e4ecf5',
          200: '#c5d8eb',
          300: '#94b7db',
          400: '#5c8ec6',
          500: '#2b6cb0', // Primary Corporate Blue
          600: '#1d4f82',
          700: '#183f69',
          800: '#133252',
          900: '#0e253c',
        },
        slate: {
          950: '#0b0f19', // Sleek dark backgrounds
        }
      },
      fontFamily: {
        sans: ['Inter', 'sans-serif'],
      },
      boxShadow: {
        glass: '0 8px 32px 0 rgba(31, 38, 135, 0.07)',
        'glass-hover': '0 8px 32px 0 rgba(31, 38, 135, 0.15)',
      }
    },
  },
  plugins: [],
}
