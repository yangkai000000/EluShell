Unicode true
Name "EluShell 安装流程测试"
OutFile "${TEST_EXE}"
RequestExecutionLevel user
!include MUI2.nsh
!include LogicLib.nsh
!include FileFunc.nsh
!include "${TEMPLATE_DIR}\include\StrContains.nsh"
Var updated
Var forced
Var launchLink
Var fixtureRoot
Var fixtureAdmin
Var installMode
Var hasPerUserInstallation
Var hasPerMachineInstallation
Var perUserInstallationFolder
Var perMachineInstallationFolder
Var requestedAll
Var requestedCurrent
!macro _isUpdated _a _b _t _f
  StrCmp $updated "yes" `${_t}` `${_f}`
!macroend
!define isUpdated `"" isUpdated ""`
!macro _isForceRun _a _b _t _f
  StrCmp $forced "yes" `${_t}` `${_f}`
!macroend
!define isForceRun `"" isForceRun ""`
!macro _isForAllUsers _a _b _t _f
  StrCmp $requestedAll "yes" `${_t}` `${_f}`
!macroend
!define isForAllUsers `"" isForAllUsers ""`
!macro _isForCurrentUser _a _b _t _f
  StrCmp $requestedCurrent "yes" `${_t}` `${_f}`
!macroend
!define isForCurrentUser `"" isForCurrentUser ""`
; The fixture simulates resolved registry scope without writing registry keys or
; elevating. Production uses electron-builder's real initMultiUser and UAC.
!macro _FixtureAdmin _a _b _t _f
  StrCmp $fixtureAdmin "yes" `${_t}` `${_f}`
!macroend
!define UAC_IsAdmin `"" FixtureAdmin ""`
!macro _FixtureInner _a _b _t _f
  StrCmp "outer" "inner" `${_t}` `${_f}`
!macroend
!define UAC_IsInnerInstance `"" FixtureInner ""`
!macro UAC_RunElevated
  SetErrorLevel 5
  Quit
!macroend
!macro setInstallModePerAllUsers
  StrCpy $installMode "all"
  StrCpy $INSTDIR $perMachineInstallationFolder
!macroend
!macro setInstallModePerUser
  StrCpy $installMode "CurrentUser"
  StrCpy $INSTDIR $perUserInstallationFolder
!macroend
!macro quitSuccess
  SetErrorLevel 0
  Quit
!macroend
!define StdUtils.ExecShellAsUser "!insertmacro RecordLaunch"
!macro RecordLaunch result target verb args
  FileOpen $0 "$fixtureRoot\relaunch.txt" w
  FileWrite $0 "complete"
  FileClose $0
!macroend
!macro StartApp
  Var /GLOBAL startAppArgs
!macroend
!include "${PRODUCTION_HOOK}"
; Include the upstream selection page itself, rather than bypassing its logic.
!include "${TEMPLATE_DIR}\multiUserUi.nsh"
!define MUI_PAGE_CUSTOMFUNCTION_SHOW ObserveMode
!insertmacro PAGE_INSTALL_MODE
; Generated verbatim from electron-builder's directory-page and pre-install
; callbacks so a custom installation path is tested against the real behavior.
!include "${UPSTREAM_PAGES}"
!insertmacro customPageAfterChangeDir
!insertmacro MUI_PAGE_INSTFILES
!define MUI_PAGE_CUSTOMFUNCTION_SHOW ObserveFinish
!insertmacro customFinishPage
!insertmacro MUI_LANGUAGE "SimpChinese"
LangString chooseInstallationOptions ${LANG_SIMPCHINESE} "安装选项"
LangString whoShouldThisApplicationBeInstalledFor ${LANG_SIMPCHINESE} "安装给谁"
LangString selectUserMode ${LANG_SIMPCHINESE} "请选择安装范围"
LangString forAll ${LANG_SIMPCHINESE} "为所有用户安装"
LangString onlyForMe ${LANG_SIMPCHINESE} "仅为我安装"
LangString loginWithAdminAccount ${LANG_SIMPCHINESE} "需要管理员"
LangString perUserInstallExists ${LANG_SIMPCHINESE} "已有个人安装"
LangString perMachineInstallExists ${LANG_SIMPCHINESE} "已有全局安装"
LangString reinstallUpgrade ${LANG_SIMPCHINESE} "升级"
LangString freshInstallForCurrent ${LANG_SIMPCHINESE} "个人安装"
LangString freshInstallForAll ${LANG_SIMPCHINESE} "所有用户安装"
Function .onInit
  StrCpy $fixtureRoot $INSTDIR
  StrCpy $perUserInstallationFolder "$fixtureRoot\Custom SSH Tools"
  StrCpy $perMachineInstallationFolder "$fixtureRoot\Machine SSH Tools"
  StrCpy $hasPerUserInstallation "1"
  StrCpy $hasPerMachineInstallation "0"
  !insertmacro setInstallModePerUser
  ${GetParameters} $R0
  ${GetOptions} $R0 "--updated" $R1
  ${IfNot} ${Errors}
    StrCpy $updated "yes"
  ${EndIf}
  ClearErrors
  ${GetOptions} $R0 "--force-run" $R1
  ${IfNot} ${Errors}
    StrCpy $forced "yes"
  ${EndIf}
  ClearErrors
  ${GetOptions} $R0 "--existing-machine" $R1
  ${IfNot} ${Errors}
    StrCpy $fixtureAdmin "yes"
    StrCpy $hasPerUserInstallation "0"
    StrCpy $hasPerMachineInstallation "1"
    !insertmacro setInstallModePerAllUsers
  ${EndIf}
  ClearErrors
  ${GetOptions} $R0 "/allusers" $R1
  ${IfNot} ${Errors}
    StrCpy $fixtureAdmin "yes"
    StrCpy $requestedAll "yes"
    !insertmacro setInstallModePerAllUsers
  ${EndIf}
  ClearErrors
  ${GetOptions} $R0 "/currentuser" $R1
  ${IfNot} ${Errors}
    StrCpy $requestedCurrent "yes"
    !insertmacro setInstallModePerUser
  ${EndIf}
  !insertmacro customInit
FunctionEnd
Function RecordPage
  FileOpen $3 "$fixtureRoot\pages.txt" a
  FileSeek $3 0 END
  FileWrite $3 "$4$\r$\n"
  FileClose $3
FunctionEnd
; Only the fresh-install fixture clicks through its wizard. Updates must never
; invoke this timer: seeing any selection page makes their assertions fail.
Function AdvanceFreshWizard
  GetFunctionAddress $0 AdvanceFreshWizard
  nsDialogs::KillTimer $0
  System::Call 'user32::PostMessageW(p $HWNDPARENT, i ${WM_COMMAND}, p 1, p 0)'
FunctionEnd
Function ScheduleFreshAdvance
  ${ifNot} ${isUpdated}
    GetFunctionAddress $0 AdvanceFreshWizard
    nsDialogs::CreateTimer $0 600
  ${endif}
FunctionEnd
Function ObserveMode
  StrCpy $4 "scope"
  Call RecordPage
  Call ScheduleFreshAdvance
FunctionEnd
Function ObserveDirectory
  StrCpy $4 "directory"
  Call RecordPage
  Call AdvanceFreshWizard
FunctionEnd
Function ObserveFinish
  StrCpy $4 "finish"
  Call RecordPage
  Call AdvanceFreshWizard
FunctionEnd
Function ObserveProgress
  FileOpen $3 "$fixtureRoot\progress.txt" a
  FileSeek $3 0 END
  System::Call 'user32::IsWindowVisible(p $HWNDPARENT) i.r0'
  System::Call 'user32::IsWindowVisible(p $mui.InstFilesPage.ProgressBar) i.r1'
  SendMessage $mui.InstFilesPage.ProgressBar 1032 0 0 $2
  FileWrite $3 "$0,$1,$2$\r$\n"
  FileClose $3
FunctionEnd
Section
  !insertmacro StartApp
  SetOutPath $INSTDIR
  StrCpy $4 "progress"
  Call RecordPage
  Sleep 100
  Call ObserveProgress
!include "${EXTRACT_STEPS}"
  FileOpen $0 "$fixtureRoot\installed.txt" w
  FileWrite $0 "$installMode$\r$\n$INSTDIR"
  FileClose $0
SectionEnd
