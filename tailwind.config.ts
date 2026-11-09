import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        chronos: {
          gold: "#F59E0B",
          amber: "#D97706",
          cyan: "#06B6D4",
          emerald: "#10B981",
          obsidian: "#07090E",
          panel: "#0D121D",
        },
      },
    },
  },
  plugins: [],
};

export default config;
