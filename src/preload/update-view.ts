import type { UpdateStatus } from '../shared/contracts'
import { PRODUCT_NAME } from '../shared/brand'

export type UpdateLocale = 'en' | 'zh'

export function shouldShowUpdate(status: UpdateStatus): boolean {
  if (['available', 'downloading', 'downloaded'].includes(status.phase)) return true
  return status.manual && ['checking', 'up-to-date', 'error', 'unsupported'].includes(status.phase)
}

export function isUpdateDismissed(
  status: UpdateStatus,
  dismissedVersion: string | null,
  dismissedTransientPhase: UpdateStatus['phase'] | null = null
): boolean {
  if (status.availableVersion) return status.availableVersion === dismissedVersion
  return status.phase === dismissedTransientPhase
}

export interface UpdateHeadline {
  title: string
  description: string
}

/**
 * The card's two lines: what happened, then what it means for the user.
 *
 * The version belongs in the second line rather than the first — a release
 * number answers "which one", not "what now", and reading the state should not
 * require parsing a version string out of a sentence.
 */
export function updateHeadline(status: UpdateStatus, locale: UpdateLocale): UpdateHeadline {
  const zh = locale === 'zh'
  const version = status.availableVersion ? `v${status.availableVersion}` : ''

  if (status.downgrade && status.availableVersion) {
    return {
      title: zh ? `正在降级到 ${version}` : `Downgrading to ${version}`,
      description: zh
        ? `将当前 v${status.currentVersion} 回退到 ${version}`
        : `Rolling back v${status.currentVersion} to ${version}`
    }
  }

  switch (status.phase) {
    case 'checking':
      return {
        title: zh ? '正在检查更新' : 'Checking for updates',
        description: zh ? `当前 v${status.currentVersion}` : `Currently on v${status.currentVersion}`
      }
    case 'available':
      return {
        title: zh ? '发现更新' : 'Update found',
        description: zh ? `正在准备下载 ${version}。` : `Getting ${version} ready to download.`
      }
    case 'downloading':
      return {
        title: zh ? '正在下载更新' : 'Downloading update',
        description: zh ? `${version} · ${Math.round(status.percent ?? 0)}%` : `${version} · ${Math.round(status.percent ?? 0)}%`
      }
    case 'downloaded':
      return {
        title: zh ? '更新已就绪' : 'Update ready',
        description: zh ? `重新启动即可安装 ${version}。` : `Restart to install ${version}.`
      }
    case 'up-to-date':
      return {
        title: zh ? '已是最新版本' : 'Up to date',
        description: zh ? `当前 v${status.currentVersion}` : `Currently on v${status.currentVersion}`
      }
    case 'unsupported':
      return {
        title: zh ? '自动更新已关闭' : 'Automatic updates are off',
        description: zh ? `安装最新的 ${PRODUCT_NAME} 测试版即可更新。` : `Install the latest ${PRODUCT_NAME} beta to update.`
      }
    case 'error':
      return {
        title: zh ? '更新失败' : 'Update failed',
        description: zh ? '无法检查或下载更新。' : 'Unable to check for or download updates.'
      }
    case 'idle':
      return { title: '', description: '' }
  }
}

export function updateMessage(status: UpdateStatus, locale: UpdateLocale): string {
  const zh = locale === 'zh'
  const version = status.availableVersion ? ` ${status.availableVersion}` : ''

  if (status.downgrade && status.availableVersion) {
    const percent = Math.round(status.percent ?? 0)
    if (status.phase === 'downloading') {
      return zh ? `正在降级到 ${status.availableVersion}（${percent}%）` : `Downgrading to ${status.availableVersion} (${percent}%)`
    }
    if (status.phase === 'downloaded') {
      return zh
        ? `降级包 ${status.availableVersion} 已就绪，重启后生效`
        : `Downgrade ${status.availableVersion} is ready to install`
    }
    return zh ? `正在准备降级到 ${status.availableVersion}` : `Preparing to downgrade to ${status.availableVersion}`
  }

  switch (status.phase) {
    case 'checking':
      return zh ? '正在检查更新…' : 'Checking for updates…'
    case 'available':
      return zh
        ? `发现新版本${version}，正在下载`
        : `${PRODUCT_NAME}${version} is available and downloading`
    case 'downloading': {
      const percent = Math.round(status.percent ?? 0)
      return zh ? `正在下载更新 ${percent}%` : `Downloading update ${percent}%`
    }
    case 'downloaded':
      return zh ? `${PRODUCT_NAME}${version} 已下载完成` : `${PRODUCT_NAME}${version} is ready to install`
    case 'up-to-date':
      return zh ? `${PRODUCT_NAME} 已是最新版本` : `${PRODUCT_NAME} is up to date`
    case 'unsupported':
      return zh ? '当前版本不支持自动更新' : 'Automatic updates are unavailable in this build'
    case 'error':
      return zh ? '无法检查或下载更新' : 'Unable to check for or download updates'
    case 'idle':
      return ''
  }
}
