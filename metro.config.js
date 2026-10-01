const {getDefaultConfig, mergeConfig} = require('@react-native/metro-config');
const exclusionList = require('metro-config/src/defaults/exclusionList');

/**
 * Metro configuration
 * https://reactnative.dev/docs/metro
 *
 * @type {import('metro-config').MetroConfig}
 */
const config = {
  resolver: {blockList: exclusionList([/[/\\]Source_Code[/\\].*/])},
};

module.exports = mergeConfig(getDefaultConfig(__dirname), config);
