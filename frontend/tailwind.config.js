/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        copa: {
          green: '#009c3b',
          'green-dark': '#007a2e',
          yellow: '#FFDF00',
          'yellow-dark': '#e6c800',
          blue: '#002776',
          'blue-dark': '#001a54',
          navy: '#0A0E1A',
          'navy-light': '#141929',
          card: '#1a2035',
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
      },
      animation: {
        'pulse-slow': 'pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        shimmer: 'shimmer 2s infinite',
      },
      keyframes: {
        shimmer: {
          '0%': { backgroundPosition: '-200% 0' },
          '100%': { backgroundPosition: '200% 0' },
        },
      },
    },
  },
  plugins: [],
}
