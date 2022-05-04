module.exports = {
  env: {
    browser: false,
    es2021: true,
    mocha: true,
    node: true,
  },
  plugins: ["prettier"],
  extends: ["standard", "prettier"],
  rules: {
    "prettier/prettier": "error",
    "no-unused-expressions": "off",
  },
  parserOptions: {
    ecmaVersion: 12,
  },
  overrides: [
    {
      files: ["hardhat.config.js"],
      globals: { task: true },
    },
  ],
};
