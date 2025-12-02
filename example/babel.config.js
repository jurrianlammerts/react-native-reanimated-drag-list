const path = require('path');
const { getConfig } = require('react-native-builder-bob/babel-config');
const pkg = require('../package.json');

const root = path.resolve(__dirname, '..');

module.exports = function (api) {
  api.cache(true);

  const config = getConfig(
    {
      presets: ['babel-preset-expo'],
    },
    { root, pkg }
  );

  return {
    ...config,
    plugins: [...(config.plugins || []), 'react-native-worklets/plugin'],
  };
};
