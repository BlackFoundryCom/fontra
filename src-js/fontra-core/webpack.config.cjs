let CopyPlugin = require("copy-webpack-plugin");
let path = require("path");

module.exports = {
  plugins: [
    new CopyPlugin({
      patterns: [
        {
          context: path.resolve(__dirname, "assets"),
          from: "**/*",
        },
      ],
    }),
  ],
};
