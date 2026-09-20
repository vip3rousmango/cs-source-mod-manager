import type { ForgeConfig } from '@electron-forge/shared-types'
import { VitePlugin } from '@electron-forge/plugin-vite'
import { MakerSquirrel } from '@electron-forge/maker-squirrel'
import { MakerDeb } from '@electron-forge/maker-deb'
import { MakerZIP } from '@electron-forge/maker-zip'

const config: ForgeConfig = {
  packagerConfig: {
    asar: true,
    name: 'counter-strike-source-mod-manager',
    executableName: 'cs-source-mod-manager',
    extraResource: ['catalog']
  },
  rebuildConfig: {},
  makers: [
    new MakerSquirrel({}),
    new MakerDeb({ options: { maintainer: 'vip3rousmango', homepage: 'https://github.com/vip3rousmango/cs-source-mod-manager' } }),
    new MakerZIP({}, ['linux', 'darwin'])
  ],
  plugins: [
    new VitePlugin({
      build: [
        { entry: 'src/main/index.ts', config: 'vite.main.config.ts' },
        { entry: 'src/preload/index.ts', config: 'vite.preload.config.ts' }
      ],
      renderer: [{ name: 'main_window', config: 'vite.renderer.config.ts' }]
    })
  ]
}

export default config
