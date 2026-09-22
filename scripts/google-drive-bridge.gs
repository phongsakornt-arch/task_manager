const DEFAULT_ROOT_FOLDER_ID = "1qvppn6VGhG_wDv4lQIAgUt4y_iOSord-";

const ALLOWED_ATTACHMENT_MIMES = [
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  "application/pdf",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
];

function bridgeProp_(key, fallback) {
  const value = PropertiesService.getScriptProperties().getProperty(key);
  return value && String(value).trim() ? String(value).trim() : fallback;
}

function bridgeJson_(body, status) {
  return ContentService
    .createTextOutput(JSON.stringify(Object.assign({ status: status || 200 }, body)))
    .setMimeType(ContentService.MimeType.JSON);
}

function doPost(e) {
  try {
    const body = JSON.parse(e && e.postData && e.postData.contents ? e.postData.contents : "{}");
    const expectedSecret = bridgeProp_("DRIVE_BRIDGE_SECRET", "");
    if (!expectedSecret || body.secret !== expectedSecret) {
      return bridgeJson_({ success: false, error: "Unauthorized" }, 401);
    }

    if (body.action === "createTaskFolder") {
      return bridgeJson_({ success: true, folder: bridgeCreateTaskFolder_(body.taskId, body.title) });
    }

    if (body.action === "uploadTaskFiles") {
      return bridgeJson_({ success: true, result: bridgeUploadTaskFiles_(body) });
    }

    return bridgeJson_({ success: false, error: "Unsupported action" }, 400);
  } catch (error) {
    return bridgeJson_({ success: false, error: error && error.message ? error.message : String(error) }, 500);
  }
}

function bridgeRootFolder_() {
  return DriveApp.getFolderById(bridgeProp_("ROOT_FOLDER_ID", DEFAULT_ROOT_FOLDER_ID));
}

function bridgeSafeName_(name) {
  return String(name || "file").replace(/[\\/:*?"<>|]/g, "_").substring(0, 120) || "file";
}

function bridgeTaskFolderName_(taskId, title) {
  return String(taskId || "task") + "_" + bridgeSafeName_(title || "task").substring(0, 40);
}

function bridgeFolderUrl_(folder) {
  return "https://drive.google.com/drive/folders/" + folder.getId();
}

function bridgeGetFolderFromUrl_(url) {
  if (!url) return null;
  const match = String(url).match(/folders\/([a-zA-Z0-9-_]+)/);
  const id = match ? match[1] : "";
  if (!id) return null;
  try {
    return DriveApp.getFolderById(id);
  } catch (error) {
    return null;
  }
}

function bridgeCreateTaskFolder_(taskId, title) {
  const root = bridgeRootFolder_();
  const folder = root.createFolder(bridgeTaskFolderName_(taskId, title));
  return {
    id: folder.getId(),
    name: folder.getName(),
    url: bridgeFolderUrl_(folder)
  };
}

function bridgeGetOrCreateTaskFolder_(taskId, title, driveFolderUrl) {
  const existing = bridgeGetFolderFromUrl_(driveFolderUrl);
  if (existing) return existing;
  return DriveApp.getFolderById(bridgeCreateTaskFolder_(taskId, title).id);
}

function bridgeUploadTaskFiles_(body) {
  if (!body.taskId) throw new Error("taskId is required");
  const files = Array.isArray(body.files) ? body.files : [];
  const folder = bridgeGetOrCreateTaskFolder_(body.taskId, body.title, body.driveFolderUrl);

  const uploaded = files.map(function(file) {
    const mimeType = String(file.mimeType || "application/octet-stream");
    if (ALLOWED_ATTACHMENT_MIMES.indexOf(mimeType) < 0) {
      throw new Error("File type is not allowed: " + mimeType);
    }
    const parts = String(file.dataUrl || "").split(",");
    const base64 = parts.length > 1 ? parts[1] : parts[0];
    if (!base64) throw new Error("Missing file data");

    const safeName = bridgeSafeName_(file.name || "attachment");
    const blob = Utilities.newBlob(Utilities.base64Decode(base64), mimeType, safeName);
    const driveFile = folder.createFile(blob);
    driveFile.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    return {
      id: driveFile.getId(),
      name: safeName,
      url: driveFile.getUrl(),
      mimeType: mimeType,
      uploadedAt: new Date().toISOString()
    };
  });

  return {
    folder: {
      id: folder.getId(),
      name: folder.getName(),
      url: bridgeFolderUrl_(folder)
    },
    files: uploaded
  };
}
