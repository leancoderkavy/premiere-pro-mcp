(function (root, factory) {
  var api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.MCPBridgeDirectorySecurity = api;
}(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  var WINDOWS_ACL_SCRIPT = [
    '$ErrorActionPreference = "Stop"',
    '$path = [Environment]::GetEnvironmentVariable("PREMIERE_MCP_ACL_PATH", "Process")',
    'if ([string]::IsNullOrWhiteSpace($path)) { throw "Bridge path environment variable is missing" }',
    '$acl = [System.IO.Directory]::GetAccessControl($path)',
    '$current = [System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value',
    '$initialize = [Environment]::GetEnvironmentVariable("PREMIERE_MCP_ACL_INITIALIZE", "Process") -eq "1"',
    '$trustedAncestors = @($current, "S-1-5-18", "S-1-5-32-544", "S-1-5-80-956008885-3418522649-1831038044-1853292631-2271478464")',
    '$replacement = [System.Security.AccessControl.FileSystemRights]::DeleteSubdirectoriesAndFiles -bor [System.Security.AccessControl.FileSystemRights]::Delete -bor [System.Security.AccessControl.FileSystemRights]::ChangePermissions -bor [System.Security.AccessControl.FileSystemRights]::TakeOwnership',
    '$unsafeAncestors = @()',
    '$ancestor = (New-Object System.IO.DirectoryInfo($path)).Parent',
    'while ($null -ne $ancestor) {',
    '  $ancestorAttributes = [System.IO.File]::GetAttributes($ancestor.FullName)',
    '  if (($ancestorAttributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) { $unsafeAncestors += [pscustomobject]@{ sid = ""; path = $ancestor.FullName; reason = "reparse_point" } }',
    '  $ancestorAcl = [System.IO.Directory]::GetAccessControl($ancestor.FullName)',
    '  $ancestorOwner = $ancestorAcl.GetOwner([System.Security.Principal.SecurityIdentifier]).Value',
    '  if ($ancestorOwner -notin $trustedAncestors) { $unsafeAncestors += [pscustomobject]@{ sid = $ancestorOwner; path = $ancestor.FullName; reason = "owner" } }',
    '  $unsafeAncestors += @($ancestorAcl.GetAccessRules($true, $true, [System.Security.Principal.SecurityIdentifier]) | Where-Object {',
    '    $_.AccessControlType -eq [System.Security.AccessControl.AccessControlType]::Allow -and (($_.PropagationFlags -band [System.Security.AccessControl.PropagationFlags]::InheritOnly) -eq 0) -and (($_.FileSystemRights -band $replacement) -ne 0) -and $_.IdentityReference.Value -notin $trustedAncestors -and $_.IdentityReference.Value -notlike "S-1-15-*"',
    '  } | ForEach-Object { [pscustomobject]@{ sid = $_.IdentityReference.Value; path = $ancestor.FullName; reason = "replacement_rights" } })',
    '  $ancestor = $ancestor.Parent',
    '}',
    'if ($initialize) {',
    '  if ($unsafeAncestors.Count -ne 0) { throw ("Bridge directory ancestry is unsafe: " + (($unsafeAncestors | ForEach-Object { "{0} ({1}: {2})" -f $_.path, $_.reason, $_.sid }) -join "; ")) }',
    '  $acl.SetAccessRuleProtection($true, $false)',
    '  $inheritance = [System.Security.AccessControl.InheritanceFlags]::ContainerInherit -bor [System.Security.AccessControl.InheritanceFlags]::ObjectInherit',
    '  $propagation = [System.Security.AccessControl.PropagationFlags]::None',
    '  foreach ($sid in @($current, "S-1-5-18", "S-1-5-32-544")) {',
    '    $identity = New-Object System.Security.Principal.SecurityIdentifier($sid)',
    '    $rule = New-Object System.Security.AccessControl.FileSystemAccessRule($identity, [System.Security.AccessControl.FileSystemRights]::FullControl, $inheritance, $propagation, [System.Security.AccessControl.AccessControlType]::Allow)',
    '    [void]$acl.AddAccessRule($rule)',
    '  }',
    '  [System.IO.Directory]::SetAccessControl($path, $acl)',
    '  $acl = [System.IO.Directory]::GetAccessControl($path)',
    '}',
    '$owner = $acl.GetOwner([System.Security.Principal.SecurityIdentifier]).Value',
    '$mutating = [System.Security.AccessControl.FileSystemRights]::WriteData -bor [System.Security.AccessControl.FileSystemRights]::AppendData -bor [System.Security.AccessControl.FileSystemRights]::WriteExtendedAttributes -bor [System.Security.AccessControl.FileSystemRights]::DeleteSubdirectoriesAndFiles -bor [System.Security.AccessControl.FileSystemRights]::WriteAttributes -bor [System.Security.AccessControl.FileSystemRights]::Delete -bor [System.Security.AccessControl.FileSystemRights]::ChangePermissions -bor [System.Security.AccessControl.FileSystemRights]::TakeOwnership',
    '$trusted = @($current, "S-1-5-18", "S-1-5-32-544")',
    '$unsafe = @($acl.GetAccessRules($true, $true, [System.Security.Principal.SecurityIdentifier]) | Where-Object {',
    '  $_.AccessControlType -eq [System.Security.AccessControl.AccessControlType]::Allow -and (($_.FileSystemRights -band $mutating) -ne 0)',
    '} | ForEach-Object {',
    '  if ($_.IdentityReference.Value -notin $trusted -and $_.IdentityReference.Value -notlike "S-1-15-*") { [pscustomobject]@{ sid = $_.IdentityReference.Value; isInherited = [bool]$_.IsInherited } }',
    '})',
    '[pscustomobject]@{ ownerSid = $owner; currentUserSid = $current; unsafeWriteAces = $unsafe; unsafeAncestorEntries = $unsafeAncestors } | ConvertTo-Json -Compress',
  ].join("\n");

  // Capability (S-1-15-3-*) and app-container package (S-1-15-2-*) SIDs are not
  // logon principals; stock profiles inherit one with FullControl on AppData (#581).
  function isWindowsCapabilitySid(sid) {
    return typeof sid === "string" && sid.toUpperCase().indexOf("S-1-15-") === 0;
  }

  function createBridgeDirectorySecurity(runtime) {
    if (!runtime || !runtime.fs || !runtime.path) {
      throw new Error("Bridge directory security requires filesystem and path runtimes");
    }
    var fs = runtime.fs;
    var path = runtime.path;
    var platform = runtime.platform || (runtime.process && runtime.process.platform) || "";

    function inspectWindowsAcl(directory, initialize) {
      if (typeof runtime.inspectWindowsAcl === "function") {
        return runtime.inspectWindowsAcl(directory, initialize);
      }
      if (!runtime.childProcess || typeof runtime.childProcess.execFileSync !== "function") {
        throw new Error("Windows ACL inspection is unavailable");
      }
      if (!runtime.Buffer || typeof runtime.Buffer.from !== "function") {
        throw new Error("Windows ACL command encoding is unavailable");
      }
      var commandEnvironment = {};
      var sourceEnvironment = runtime.process && runtime.process.env ? runtime.process.env : {};
      Object.keys(sourceEnvironment).forEach(function (key) {
        commandEnvironment[key] = sourceEnvironment[key];
      });
      commandEnvironment.PREMIERE_MCP_ACL_PATH = directory;
      commandEnvironment.PREMIERE_MCP_ACL_INITIALIZE = initialize ? "1" : "0";
      var encodedCommand = runtime.Buffer.from(WINDOWS_ACL_SCRIPT, "utf16le").toString("base64");
      var raw = runtime.childProcess.execFileSync(
        "powershell.exe",
        ["-NoProfile", "-NonInteractive", "-EncodedCommand", encodedCommand],
        {
          encoding: "utf8",
          windowsHide: true,
          stdio: ["ignore", "pipe", "pipe"],
          timeout: 5000,
          maxBuffer: 64 * 1024,
          env: commandEnvironment,
        }
      );
      return JSON.parse(String(raw).trim());
    }

    function currentUid() {
      if (typeof runtime.currentUid === "number") return runtime.currentUid;
      if (runtime.process && typeof runtime.process.getuid === "function") {
        return runtime.process.getuid();
      }
      return null;
    }

    function validateDirectoryStatus(directory, entry) {
      if (!entry || typeof entry.isSymbolicLink !== "function" || typeof entry.isDirectory !== "function") {
        throw new Error("Bridge directory metadata could not be verified");
      }
      if (entry.isSymbolicLink()) {
        throw new Error("Bridge directory must not be a symbolic link or junction: " + directory);
      }
      if (!entry.isDirectory()) {
        throw new Error("Bridge path is not a directory: " + directory);
      }
    }

    function validatePosixAncestors(directory, uid) {
      if (typeof path.dirname !== "function") {
        throw new Error("Bridge directory ancestry could not be verified");
      }
      var paths = [directory];
      if (typeof fs.realpathSync === "function") {
        var canonical = fs.realpathSync(directory);
        if (canonical !== directory) paths.push(canonical);
      }
      var checked = {};
      paths.forEach(function (candidate) {
        var ancestor = path.dirname(candidate);
        while (ancestor && !checked[ancestor]) {
          checked[ancestor] = true;
          var entry = fs.lstatSync(ancestor);
          if (entry.uid !== 0 && entry.uid !== uid) {
            throw new Error("Bridge path has an untrusted replaceable ancestor " + ancestor);
          }
          if (!entry.isSymbolicLink()) {
            if (!entry.isDirectory()) throw new Error("Bridge ancestor is not a directory: " + ancestor);
            var groupReplaceable = (entry.mode & 0o030) === 0o030;
            var otherReplaceable = (entry.mode & 0o003) === 0o003;
            var sticky = (entry.mode & 0o1000) !== 0;
            if ((groupReplaceable || otherReplaceable) && !sticky) {
              throw new Error("Bridge path has a replaceable ancestor " + ancestor);
            }
          }
          var parent = path.dirname(ancestor);
          if (parent === ancestor) break;
          ancestor = parent;
        }
      });
    }

    function ensurePrivateBridgeDirectory(directory) {
      if (typeof directory !== "string" || !directory.trim()) {
        throw new Error("Bridge directory must be a non-empty path");
      }
      var resolved = path.resolve(directory.trim());
      var createdPath = fs.mkdirSync(resolved, { recursive: true, mode: 0o700 });
      var newlyCreated = typeof createdPath === "string";

      var entry = fs.lstatSync(resolved);
      validateDirectoryStatus(resolved, entry);

      if (platform === "win32") {
        var acl;
        try {
          acl = inspectWindowsAcl(resolved, newlyCreated);
        } catch (error) {
          throw new Error(
            "Could not verify the Windows ACL for bridge directory " + resolved + ": " +
            (error && error.message ? error.message : String(error))
          );
        }
        if (!acl || !acl.ownerSid || !acl.currentUserSid || acl.ownerSid !== acl.currentUserSid) {
          throw new Error("Bridge directory is not owned by the current Windows user: " + resolved);
        }
        var unsafe = (Array.isArray(acl.unsafeWriteAces)
          ? acl.unsafeWriteAces
          : acl.unsafeWriteAces
            ? [acl.unsafeWriteAces]
            : []).filter(function (ace) { return !isWindowsCapabilitySid(ace && ace.sid); });
        if (unsafe.length > 0) {
          var unsafeSids = unsafe.map(function (ace) { return ace && ace.sid ? ace.sid : "unknown"; });
          throw new Error(
            "Bridge directory grants write access to untrusted identities (" + unsafeSids.join(", ") + "): " + resolved
          );
        }
        var unsafeAncestors = (Array.isArray(acl.unsafeAncestorEntries)
          ? acl.unsafeAncestorEntries
          : acl.unsafeAncestorEntries
            ? [acl.unsafeAncestorEntries]
            : []).filter(function (entry) {
          return !entry || entry.reason !== "replacement_rights" || !isWindowsCapabilitySid(entry.sid);
        });
        if (unsafeAncestors.length > 0) {
          throw new Error(
            "Bridge path has a replaceable ancestor " + unsafeAncestors.map(function (entry) {
              return (entry && entry.path) + " (" + (entry && entry.reason) + ": " + (entry && entry.sid ? entry.sid : "none") + ")";
            }).join("; ")
          );
        }
        if (newlyCreated && fs.readdirSync(resolved).length > 0) {
          throw new Error("Bridge directory rejected because unexpected contents appeared during creation: " + resolved);
        }
        return resolved;
      }

      var uid = currentUid();
      if (uid === null || typeof entry.uid !== "number") {
        throw new Error("Could not verify bridge directory ownership on platform " + platform);
      }
      if (entry.uid !== uid) {
        throw new Error("Bridge directory is owned by another user: " + resolved);
      }
      if (!newlyCreated && (entry.mode & 0o022) !== 0) {
        throw new Error("Bridge directory was writable by other users before validation: " + resolved);
      }
      validatePosixAncestors(resolved, uid);
      if ((entry.mode & 0o077) !== 0) {
        fs.chmodSync(resolved, 0o700);
        entry = fs.lstatSync(resolved);
        validateDirectoryStatus(resolved, entry);
        if (entry.uid !== uid) {
          throw new Error("Bridge directory ownership changed during validation: " + resolved);
        }
        if ((entry.mode & 0o077) !== 0) {
          throw new Error("Bridge directory permissions are not owner-only: " + resolved);
        }
      }
      return resolved;
    }

    return { ensurePrivateBridgeDirectory: ensurePrivateBridgeDirectory };
  }

  return {
    createBridgeDirectorySecurity: createBridgeDirectorySecurity,
    windowsAclScript: WINDOWS_ACL_SCRIPT,
  };
}));
