; Updates must remain visible even when an older EluShell starts us with /S.
; Normal unattended installations without --updated still honor /S.
!macro customInit
  ${if} ${isUpdated}
    SetSilent normal
  ${endif}
!macroend

; initMultiUser has already resolved explicit scope flags and existing registry
; records. Force that resolved mode only for updates so PAGE_INSTALL_MODE skips
; its radio-button page and retains its normal elevation/path handling.
!macro customInstallMode
  !ifndef BUILD_UNINSTALLER
    ${if} ${isUpdated}
      ${if} $installMode == "all"
        StrCpy $isForceMachineInstall "1"
      ${else}
        StrCpy $isForceCurrentInstall "1"
      ${endif}
    ${endif}
  !endif
!macroend

!macro customPageAfterChangeDir
  ; The assisted install-files PRE callback appends APP_FILENAME to custom
  ; paths. Apply that first-install behavior only outside an update, otherwise
  ; a previously chosen directory such as D:\Tools\SSH would change.
  !ifdef MUI_PAGE_CUSTOMFUNCTION_PRE
    !define ELUSHELL_ORIGINAL_INSTALL_PRE "${MUI_PAGE_CUSTOMFUNCTION_PRE}"
    !undef MUI_PAGE_CUSTOMFUNCTION_PRE
    !define MUI_PAGE_CUSTOMFUNCTION_PRE EluShellInstallPre
    Function EluShellInstallPre
      ${ifNot} ${isUpdated}
        Call "${ELUSHELL_ORIGINAL_INSTALL_PRE}"
      ${endif}
    FunctionEnd
    !undef ELUSHELL_ORIGINAL_INSTALL_PRE
  !endif
  !define MUI_PAGE_CUSTOMFUNCTION_SHOW EluShellInstallShow
  Function EluShellInstallShow
    ${if} ${isUpdated}
      !insertmacro MUI_HEADER_TEXT "正在更新 EluShell" "正在安装程序文件，请稍候。完成后将自动重新打开。"
      BringToFront
    ${endif}
  FunctionEnd
!macroend

; Keep the ordinary setup completion page. Updates finish and relaunch only
; after the install-files page has completed successfully.
!macro customFinishPage
  !define MUI_PAGE_CUSTOMFUNCTION_PRE EluShellUpdateFinish
  Function EluShellUpdateFinish
    ${if} ${isUpdated}
      ${if} ${isForceRun}
        HideWindow
        ${StdUtils.ExecShellAsUser} $0 "$launchLink" "open" "--updated"
      ${endif}
      !insertmacro quitSuccess
    ${endif}
  FunctionEnd
  !insertmacro MUI_PAGE_FINISH
!macroend
