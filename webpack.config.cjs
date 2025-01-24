const HtmlBundlerPlugin = require("html-bundler-webpack-plugin");
const makeConfig = require("@fontra/core/webpack-base.js").makeConfig;
const path = require("path");

module.exports = (_env, argv) => {
  return makeConfig({
    home: __dirname,
    destination: path.resolve(__dirname, "src", "fontra", "client"),
    views: [
      // Unfortunately we run into version compatibility problems if we get
      // webpack-base.js to provide its own HtmlBundlerPlugin, so we have
      // to provide our own.
      new HtmlBundlerPlugin({
        entry: {
          landing: require.resolve("@fontra/projectmanager-filesystem/landing.html"),
          applicationsettings: require.resolve(
            "@fontra/views-applicationsettings/applicationsettings.html"
          ),
          editor: require.resolve("@fontra/views-editor/editor.html"),
          fontinfo: require.resolve("@fontra/views-fontinfo/fontinfo.html"),
          fontoverview: require.resolve("@fontra/views-fontoverview/fontoverview.html"),
        },
      }),
    ],
    production: argv.mode === "production",
    custom: {
      extends: require.resolve("@fontra/core/webpack.config.cjs"), // This does the copy of core assets
    },
  });
};
