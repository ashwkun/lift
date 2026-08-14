module.exports = function (api) {
  api.cache(true);
  return {
    presets: ['babel-preset-expo'],
    plugins: [
      // Lets `import migration from './0000_init.sql'` inline the file contents
      // as a string, which is how drizzle-kit's generated migrations are loaded.
      ['inline-import', { extensions: ['.sql'] }],
    ],
  };
};
