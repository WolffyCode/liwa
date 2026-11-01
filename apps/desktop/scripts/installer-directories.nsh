!include "LogicLib.nsh"

Var liwaFinalDirectory
Var liwaNewDirectory
Var liwaOldDirectory
Var liwaOldMoved
Var liwaNewMoved
Var liwaDirectoryError
Var liwaDirectorySource
Var liwaDirectoryDestination
Var liwaRestoreError
Var liwaDirectoryLogDirectory
Var liwaRecoveryStopped

; MoveFileEx preserves the destination and exposes the Windows error before rollback changes it.
; Open files inside a directory can make its rename return access denied (5).
!macro liwaDirectoryOperation SOURCE DESTINATION RESULT PHASE
  Push $0
  Push $1
  Push $2
  StrCpy $0 0
  ${Do}
    ${If} "${DESTINATION}" == ""
      System::Call 'kernel32::RemoveDirectoryW(w "${SOURCE}") i.r1 ?e'
    ${Else}
      System::Call 'kernel32::MoveFileExW(w "${SOURCE}", w "${DESTINATION}", i 0) i.r1 ?e'
    ${EndIf}
    Pop ${RESULT}
    ${If} "${DESTINATION}" == ""
      ${If} ${RESULT} == 2
      ${OrIf} ${RESULT} == 3
        StrCpy $1 1
      ${EndIf}
    ${EndIf}
    ${If} $1 != 0
      StrCpy ${RESULT} 0
      ${ExitDo}
    ${EndIf}
    ClearErrors
    FileOpen $2 "$PLUGINSDIR\directory-operations.log" a
    ${IfNot} ${Errors}
      FileSeek $2 0 END
      FileWrite $2 "${PHASE}: Windows error: ${RESULT}$\r$\n"
      FileClose $2
    ${EndIf}
    ${If} ${RESULT} != 5
    ${AndIf} ${RESULT} != 32
    ${AndIf} ${RESULT} != 33
      ${ExitDo}
    ${EndIf}
    IntOp $0 $0 + 1
    ${If} $0 >= 10
      ${ExitDo}
    ${EndIf}
    IntOp $1 $0 * 250
    Sleep $1
  ${Loop}
  Pop $2
  Pop $1
  Pop $0
!macroend

!macro liwaReportDirectoryFailure
  ${If} $liwaRestoreError != 0
    StrCpy $liwaRecoveryStopped "1"
  ${EndIf}
  !ifmacrodef customInstallerDirectoryFailed
    !insertmacro customInstallerDirectoryFailed
  !else
    DetailPrint "Directory operation failed ($liwaDirectoryError): $liwaDirectorySource -> $liwaDirectoryDestination; restore error: $liwaRestoreError"
  !endif
!macroend

!macro liwaExtractPayload FILE
  !ifmacrodef customInstallerExtract
    !insertmacro customInstallerExtract "${FILE}"
  !else
    nsExec::ExecToStack '"$PLUGINSDIR\liwa-7za.exe" x -y -bd -bb0 "-o$INSTDIR" "${FILE}"'
    Pop $R0
    Pop $R1
  !endif
  ${If} $R0 != 0
    DetailPrint $R1
    Call liwaRollbackDirectories
    !ifmacrodef customInstallerExtractFailed
      !insertmacro customInstallerExtractFailed "${FILE}"
    !else
      MessageBox MB_OK|MB_ICONEXCLAMATION "$(decompressionFailed)" /SD IDOK
    !endif
    SetErrorLevel 2
    Quit
  ${EndIf}
!macroend

!macro liwaStageApplication
  !ifdef LIWA_INSTALLER_LOG_DIR
    ; electron-builder defines the cache name after including our function bodies, before this section expands.
    StrCpy $liwaDirectoryLogDirectory "${LIWA_INSTALLER_LOG_DIR}"
  !endif
  StrCpy $liwaFinalDirectory $INSTDIR
  System::Call 'ole32::CoCreateGuid(g .r0) i .r1'
  ${If} $1 != 0
    SetErrorLevel 2
    Quit
  ${EndIf}
  StrCpy $liwaNewDirectory "$INSTDIR.new-$0"
  StrCpy $liwaOldDirectory "$INSTDIR.old-$0"
  StrCpy $liwaOldMoved ""
  StrCpy $liwaNewMoved ""
  StrCpy $liwaDirectoryError 0
  StrCpy $liwaRestoreError 0
  StrCpy $liwaRecoveryStopped ""
  ClearErrors
  CreateDirectory $liwaNewDirectory
  ${If} ${Errors}
    SetErrorLevel 2
    Quit
  ${EndIf}
  File /oname=$PLUGINSDIR\liwa-7za.exe "${LIWA_SEVENZIP_PATH}"
  StrCpy $INSTDIR $liwaNewDirectory
  SetOutPath $INSTDIR
  !insertmacro installApplicationFiles
  !ifdef LIWA_SEVENZIP_LICENSE_DIR
    File /oname=7zip-installer-LICENSE.txt "${LIWA_SEVENZIP_LICENSE_DIR}\LICENSE.txt"
    File /oname=7zip-installer-COPYING.txt "${LIWA_SEVENZIP_LICENSE_DIR}\COPYING"
  !endif
  !ifdef UNINSTALLER_ICON
    File /oname=uninstallerIcon.ico "${UNINSTALLER_ICON}"
  !endif
  StrCpy $INSTDIR $liwaFinalDirectory
  SetOutPath $PLUGINSDIR
!macroend

Function .onGUIEnd
  Call liwaCleanupDirectories
FunctionEnd

Function liwaCleanupDirectories
  ${If} $liwaRecoveryStopped == "1"
    Return
  ${EndIf}
  ${If} $liwaFinalDirectory != ""
    Call liwaRollbackDirectories
  ${EndIf}
FunctionEnd

; Only directories created or renamed by this installer are removed during rollback.
Function liwaRollbackDirectories
  SetOutPath $PLUGINSDIR
  ${If} $liwaNewMoved == "1"
    RMDir /r "\\?\$liwaFinalDirectory"
    StrCpy $liwaNewMoved ""
  ${EndIf}
  ${If} $liwaOldMoved == "1"
    !insertmacro liwaDirectoryOperation "$liwaOldDirectory" "$liwaFinalDirectory" $liwaRestoreError "restore"
    ${If} $liwaRestoreError != 0
      ; Leave the complete backup in place if another process prevents restoration.
      DetailPrint $liwaOldDirectory
      RMDir /r "\\?\$liwaNewDirectory"
      Return
    ${EndIf}
    StrCpy $liwaOldMoved ""
  ${EndIf}
  ${If} $liwaNewDirectory != ""
    RMDir /r "\\?\$liwaNewDirectory"
  ${EndIf}
  StrCpy $INSTDIR $liwaFinalDirectory
FunctionEnd

Function liwaPromoteDirectories
  !ifmacrodef InstallerPublishStage
    !insertmacro InstallerPublishStage 2
  !endif
  ; SetOutPath opens a directory handle; release it before either rename.
  SetOutPath $PLUGINSDIR
  ClearErrors
  ${If} ${FileExists} "$liwaFinalDirectory\*.*"
    StrCpy $liwaDirectorySource $liwaFinalDirectory
    StrCpy $liwaDirectoryDestination $liwaOldDirectory
    !insertmacro liwaDirectoryOperation "$liwaDirectorySource" "$liwaDirectoryDestination" $liwaDirectoryError "backup"
    ${If} $liwaDirectoryError != 0
      Call liwaRollbackDirectories
      !insertmacro liwaReportDirectoryFailure
      SetErrors
      Return
    ${EndIf}
    StrCpy $liwaOldMoved "1"
  ${Else}
    ; NSIS can create the destination before the install section starts.
    StrCpy $liwaDirectorySource $liwaFinalDirectory
    StrCpy $liwaDirectoryDestination ""
    !insertmacro liwaDirectoryOperation "$liwaDirectorySource" "" $liwaDirectoryError "remove-empty"
    ${If} $liwaDirectoryError != 0
      Call liwaRollbackDirectories
      !insertmacro liwaReportDirectoryFailure
      SetErrors
      Return
    ${EndIf}
  ${EndIf}
  ClearErrors
  StrCpy $liwaDirectorySource $liwaNewDirectory
  StrCpy $liwaDirectoryDestination $liwaFinalDirectory
  !insertmacro liwaDirectoryOperation "$liwaDirectorySource" "$liwaDirectoryDestination" $liwaDirectoryError "promote"
  ${If} $liwaDirectoryError != 0
    Call liwaRollbackDirectories
    !insertmacro liwaReportDirectoryFailure
    SetErrors
    Return
  ${EndIf}
  StrCpy $liwaNewMoved "1"
  SetOutPath $liwaFinalDirectory
  !ifmacrodef InstallerPublishStage
    !insertmacro InstallerPublishStage 3
  !endif
  ClearErrors
FunctionEnd

!macro liwaFinishDirectories
  StrCpy $liwaNewMoved ""
  ${If} $liwaOldMoved == "1"
    RMDir /r "\\?\$liwaOldDirectory"
    StrCpy $liwaOldMoved ""
  ${EndIf}
!macroend
