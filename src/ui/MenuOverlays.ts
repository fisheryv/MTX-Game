/**
 * 主菜单顶部按钮（帮助 / 设置）与两个弹出面板的控制器。
 * - 右上角设置按钮：切换背景音乐 / 音效开关（联动 AudioEngine 并持久化）。
 * - 左上角帮助按钮：展示游戏介绍、操作说明与开发者信息。
 * 面板打开/点击会阻止事件冒泡，避免触发菜单态的“点击起飞”。
 */
import type { AudioEngine } from '../systems/AudioEngine';

export class MenuOverlays {
  private topbar: HTMLElement;
  private helpBtn: HTMLElement;
  private settingsBtn: HTMLElement;
  private settingsModal: HTMLElement;
  private helpModal: HTMLElement;
  private settingsClose: HTMLElement;
  private helpClose: HTMLElement;
  private musicToggle: HTMLElement;
  private sfxToggle: HTMLElement;

  constructor(private readonly audio: AudioEngine) {
    this.topbar = document.getElementById('menu-topbar')!;
    this.helpBtn = document.getElementById('help-btn')!;
    this.settingsBtn = document.getElementById('settings-btn')!;
    this.settingsModal = document.getElementById('settings-modal')!;
    this.helpModal = document.getElementById('help-modal')!;
    this.settingsClose = document.getElementById('settings-close')!;
    this.helpClose = document.getElementById('help-close')!;
    this.musicToggle = document.getElementById('toggle-music')!;
    this.sfxToggle = document.getElementById('toggle-sfx')!;

    this.bind();
    this.syncToggles();
  }

  private bind() {
    // 阻止冒泡，避免点击按钮时被 PermissionModal 当作“点击起飞”
    const stop = (e: Event) => e.stopPropagation();

    this.settingsBtn.addEventListener('click', (e) => {
      stop(e);
      this.openModal(this.settingsModal);
    });
    this.helpBtn.addEventListener('click', (e) => {
      stop(e);
      this.openModal(this.helpModal);
    });
    this.settingsClose.addEventListener('click', (e) => {
      stop(e);
      this.closeModal(this.settingsModal);
    });
    this.helpClose.addEventListener('click', (e) => {
      stop(e);
      this.closeModal(this.helpModal);
    });

    // 点击遮罩空白处关闭；点击卡片内部不关闭
    this.settingsModal.addEventListener('click', (e) => {
      stop(e);
      if (e.target === this.settingsModal) this.closeModal(this.settingsModal);
    });
    this.helpModal.addEventListener('click', (e) => {
      stop(e);
      if (e.target === this.helpModal) this.closeModal(this.helpModal);
    });

    this.musicToggle.addEventListener('click', (e) => {
      stop(e);
      const on = !this.audio.isMusicEnabled();
      this.audio.setMusicEnabled(on);
      this.setToggle(this.musicToggle, on);
    });
    this.sfxToggle.addEventListener('click', (e) => {
      stop(e);
      const on = !this.audio.isSfxEnabled();
      this.audio.setSfxEnabled(on);
      this.setToggle(this.sfxToggle, on);
    });
  }

  private syncToggles() {
    this.setToggle(this.musicToggle, this.audio.isMusicEnabled());
    this.setToggle(this.sfxToggle, this.audio.isSfxEnabled());
  }

  private setToggle(el: HTMLElement, on: boolean) {
    el.setAttribute('aria-checked', on ? 'true' : 'false');
  }

  private openModal(modal: HTMLElement) {
    modal.classList.remove('hidden');
  }

  private closeModal(modal: HTMLElement) {
    modal.classList.add('hidden');
  }

  /** 进入主菜单：显示顶部按钮 */
  public showTopbar() {
    this.topbar.classList.remove('hidden');
  }

  /** 离开主菜单：隐藏顶部按钮并关闭所有面板 */
  public hideTopbar() {
    this.topbar.classList.add('hidden');
    this.closeModal(this.settingsModal);
    this.closeModal(this.helpModal);
  }
}
