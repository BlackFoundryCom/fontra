// Make a webpack configuration object with some defaults; this can be
// used both for the Fontra installation itself, and for custom out-of-tree
// views and project managers.
import HtmlBundlerPlugin from "html-bundler-webpack-plugin";
import path from "path";

const fallback = {
  fs: false,
  zlib: false,
  assert: false,
  util: false,
  stream: false,
  path: false,
  url: false,
  buffer: import.meta.resolve("buffer"),
};

const module = {
  rules: [
    {
      test: /\.s?css$/,
      use: ["css-loader"],
    },
    {
      test: /\.(ico|png|jp?g|svg)/,
      type: "asset/resource",
    },
    {
      test: /\.tsx?$/,
      loader: "babel-loader",
      exclude: /node_modules/,
      options: {
        presets: ["@babel/preset-env", "@babel/preset-typescript"],
      },
    },
  ],
};

export function makeConfig(options) {
  let destination = options.destination;
  if (!destination) {
    throw new Error("destination is required");
  }
  if (!options.home) {
    throw new Error("home is required");
  }

  const experiments = {
    asyncWebAssembly: true,
  };

  let config = {
    output: {
      path: destination,
      filename: options.production ? "[name].[contenthash].js" : "[name].js",
      chunkFormat: false,
      clean: true,
    },
    devtool: options.production ? false : "eval-source-map",
    mode: options.production ? "production" : "development",
    experiments,
    module,
    resolve: {
      modules: [path.resolve(options.home, "node_modules")],
      extensionAlias: {
        ".js": [".ts", ".js"],
      },
      fallback,
    },
    plugins: [],
  };

  if (options.subdirectory) {
    config.output.publicPath = options.subdirectory + "/";
  }

  if (options.views) {
    config.plugins = options.views;
  }

  if (options.custom) {
    Object.assign(config, options.custom);
  }
  return config;
}
