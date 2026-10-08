const packageJson = require('./package.json')

module.exports = {
  ...packageJson.build,
  appId: 'io.dsh.desktop.dev',
  productName: 'Unoblox Dev',
  directories: {
    ...packageJson.build.directories,
    output: 'dist-dev'
  },
  extraMetadata: {
    name: 'dsh-desktop-dev',
    productName: 'Unoblox Dev',
    dshDesktopChannel: 'development'
  },
  artifactName: 'dsh-desktop-dev-${os}-${arch}.${ext}',
  nsis: {
    ...packageJson.build.nsis,
    artifactName: 'dsh-desktop-dev-windows-${arch}-setup.${ext}'
  },
  publish: null
}
