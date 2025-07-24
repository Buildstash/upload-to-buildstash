const core = require('@actions/core');
const fs = require('fs');
const axios = require('axios');
const FormData = require('form-data');
const path = require('path');

async function uploadChunkedFile({
  filePath,
  filesize,
  pendingUploadId,
  chunkedNumberParts,
  chunkedPartSizeMb,
  apiKey,
  isExpansion = false
}) {
  // Read the file at filePath into a buffer
  const chunkSize = chunkedPartSizeMb * 1024 * 1024;
  const parts = [];
  const endpoint = isExpansion
    ? 'https://app.buildstash.com/api/v1/upload/request/multipart/expansion'
    : 'https://app.buildstash.com/api/v1/upload/request/multipart';

  // Loop through each part, get presigned URL, and upload it
  for (let i = 0; i < chunkedNumberParts; i++) {

    const chunkStart = i * chunkSize;
    const chunkEnd = Math.min((i + 1) * chunkSize - 1, filesize - 1);
    let chunkStream = fs.createReadStream(filePath, { start: chunkStart, end: chunkEnd });

    const contentLength = chunkEnd - chunkStart + 1;

    const partNumber = i + 1;

    core.info('Uploading chunked upload, part: ' + partNumber + ' of ' + chunkedNumberParts);

    // Request presigned URL for this part
    const presignedResp = await axios.post(
      endpoint,
      {
        pending_upload_id: pendingUploadId,
        part_number: partNumber,
        content_length: contentLength
      },
      {
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        }
      }
    );

    // Get presigned URL for this part from response
    const presignedUrl = presignedResp.data.part_presigned_url;

    // Upload chunk via presigned URL (on failure retry part once before error)
    let uploadResponse;
    let uploadError;
    // Attach error handler to the stream
    chunkStream.on('error', (err) => {
      core.error(`File stream error for part ${partNumber}: ${err.message}`);
    });
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        uploadResponse = await axios.put(
          presignedUrl,
          chunkStream,
          {
            headers: {
              'Content-Type': 'application/octet-stream',
              'Content-Length': contentLength
            },
            maxBodyLength: Infinity
          }
        );
        uploadError = null;
        break; // Success, exit retry loop
      } catch (err) {
        uploadError = err;
        // Log more error details
        if (err.response) {
          core.error(`Chunk upload for part ${partNumber} failed (attempt ${attempt}): ${err.message}, status: ${err.response.status}, data: ${JSON.stringify(err.response.data)}`);
        } else {
          core.error(`Chunk upload for part ${partNumber} failed (attempt ${attempt}): ${err.message}`);
        }
        if (attempt === 1) {
          // Re-create the stream for retry
          chunkStream.destroy();
        }
      }
      // If retrying, re-create the stream
      if (attempt === 1 && uploadError) {
        // Wait a short delay before retrying (optional, can be omitted or tuned)
        await new Promise(res => setTimeout(res, 500));
        // Re-create the stream for the retry
        chunkStream = fs.createReadStream(filePath, { start: chunkStart, end: chunkEnd });
        chunkStream.on('error', (err) => {
          core.error(`File stream error for part ${partNumber} (retry): ${err.message}`);
        });
      }
    }
    if (uploadError) {
      throw uploadError;
    }
    // Check for ETag presence
    if (!uploadResponse.headers.etag) {
      core.warning(`No ETag returned for part ${partNumber}. Response headers: ${JSON.stringify(uploadResponse.headers)}`);
    }

    // Add part to parts array
    parts.push({
      PartNumber: partNumber,
      ETag: uploadResponse.headers.etag
    });
  }

  // Return parts array
  return parts;
}

async function run() {
  try {
    // Get inputs
    const primaryFilePath = core.getInput('primary_file_path', { required: true });
    const expansionFilePath = core.getInput('expansion_file_path');
    const structure = core.getInput('structure');
    const apiKey = core.getInput('api_key', { required: true });

    // Verify primary file exists
    if (!fs.existsSync(primaryFilePath)) {
      throw new Error(`Primary file not found at path: ${primaryFilePath}`);
    }

    // Get primary file stats
    const primaryStats = fs.statSync(primaryFilePath);
    const primaryFilename = path.basename(primaryFilePath);

    // Get labels (if passed in) and parse into an array
    const labelsInput = core.getInput('labels') || '';
    const labels = labelsInput
      .split(/\r?\n/)                     // split by newline
      .map(label => label.trim())         // remove extra spaces
      .filter(label => label.length > 0); // remove blanks

    // Get architectures (if passed in) and parse into an array
    const architecturesInput = core.getInput('architectures') || '';
    const architectures = architecturesInput
      .split(/\r?\n/)
      .map(architecture => architecture.trim())
      .filter(architecture => architecture.length > 0);

    // Prepare request payload
    const payload = {
      structure: structure,
      primary_file: {
        filename: primaryFilename,
        size_bytes: primaryStats.size
      },
      version_component_1_major: core.getInput('version_component_1_major'),
      version_component_2_minor: core.getInput('version_component_2_minor'),
      version_component_3_patch: core.getInput('version_component_3_patch'),
      version_component_extra: core.getInput('version_component_extra'),
      version_component_meta: core.getInput('version_component_meta'),
      custom_build_number: core.getInput('custom_build_number'),
      labels: labels,
      architectures: architectures,
      source: 'ghactions',
      ci_pipeline: core.getInput('ci_pipeline'),
      ci_run_id: core.getInput('ci_run_id'),
      ci_run_url: core.getInput('ci_run_url'),
      ci_build_duration: core.getInput('ci_build_duration'),
      vc_host_type: core.getInput('vc_host_type'),
      vc_host: core.getInput('vc_host'),
      vc_repo_name: core.getInput('vc_repo_name'),
      vc_repo_url: core.getInput('vc_repo_url'),
      vc_branch: core.getInput('vc_branch'),
      vc_commit_sha: core.getInput('vc_commit_sha'),
      vc_commit_url: core.getInput('vc_commit_url'),
      platform: core.getInput('platform'),
      stream: core.getInput('stream'),
      notes: core.getInput('notes')
    };

    // Add expansion file info if structure is file+expansion and expansion file path provided
    if (structure === 'file+expansion' && expansionFilePath) {
      // Verify expansion file exists
      if (!fs.existsSync(expansionFilePath)) {
        throw new Error(`Expansion file not found at path: ${expansionFilePath}`);
      }

      // Get expansion file stats
      const expansionStats = fs.statSync(expansionFilePath);
      const expansionFilename = path.basename(expansionFilePath);

      payload.expansion_files = [{
        filename: expansionFilename,
        size_bytes: expansionStats.size
      }];
    }

    // Initial request to get upload URLs
    const uploadRequest = await axios.post(
      'https://app.buildstash.com/api/v1/upload/request',
      payload,
      {
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        }
      }
    );

    const { pending_upload_id, primary_file, expansion_files } = uploadRequest.data;
    let primaryFileParts = null;
    let expansionFileParts = null;

    // Handle primary file upload
    if (primary_file.chunked_upload) {
      core.info('Uploading primary file using chunked upload...');
      primaryFileParts = await uploadChunkedFile({
        filePath: primaryFilePath,
        filesize: primaryStats.size,
        pendingUploadId: pending_upload_id,
        chunkedNumberParts: primary_file.chunked_number_parts,
        chunkedPartSizeMb: primary_file.chunked_part_size_mb,
        apiKey,
        isExpansion: false
      });
    } else {
      core.info('Uploading primary file using direct upload...');
      await axios.put(
        primary_file.presigned_data.url,
        fs.createReadStream(primaryFilePath),
        {
          headers: {
            'Content-Type': primary_file.presigned_data.headers['Content-Type'],
            'Content-Length': primary_file.presigned_data.headers['Content-Length'],
            'Content-Disposition': primary_file.presigned_data.headers['Content-Disposition'],
            'x-amz-acl': 'private'
          },
          maxBodyLength: Infinity
        }
      );
    }

    // Handle expansion file upload if present
    if (expansionFilePath && expansion_files && expansion_files[0]) {
      if (expansion_files[0].chunked_upload) {
        core.info('Uploading expansion file using chunked upload...');
        expansionFileParts = await uploadChunkedFile({
          filePath: expansionFilePath,
          filesize: expansionStats.size,
          pendingUploadId: pending_upload_id,
          chunkedNumberParts: expansion_files[0].chunked_number_parts,
          chunkedPartSizeMb: expansion_files[0].chunked_part_size_mb,
          apiKey,
          isExpansion: true
        });
      } else {
        core.info('Uploading expansion file using direct upload...');
        await axios.put(
          expansion_files[0].presigned_data.url,
          fs.createReadStream(expansionFilePath),
          {
            headers: {
              'Content-Type': expansion_files[0].presigned_data.headers['Content-Type'],
              'Content-Length': expansion_files[0].presigned_data.headers['Content-Length'],
              'Content-Disposition': expansion_files[0].presigned_data.headers['Content-Disposition'],
              'x-amz-acl': 'private'
            },
            maxBodyLength: Infinity
          }
        );
      }
    }

    // Verify upload
    core.info('Verifying upload...');
    const verifyPayload = { pending_upload_id };
    
    if (primaryFileParts) {
      verifyPayload.multipart_chunks = primaryFileParts;
    }
    
    if (expansionFileParts) {
      if (!verifyPayload.multipart_chunks) verifyPayload.multipart_chunks = [];
      verifyPayload.multipart_chunks = verifyPayload.multipart_chunks.concat(expansionFileParts);
    }

    const verifyResponse = await axios.post(
      'https://app.buildstash.com/api/v1/upload/verify',
      verifyPayload,
      {
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        }
      }
    );

    // Extract the values from the response
    const buildId = verifyResponse.data.build_id;
    const pendingProcessing = verifyResponse.data.pending_processing;
    const buildInfoUrl = verifyResponse.data.build_info_url;
    const downloadUrl = verifyResponse.data.download_url;

    // Set the outputs using the Actions core library
    core.setOutput('build_id', buildId);
    core.setOutput('pending_processing', pendingProcessing);
    core.setOutput('build_info_url', buildInfoUrl);
    core.setOutput('download_url', downloadUrl);

    core.info('Upload completed and verified successfully! Uploaded build id ' + buildId);
    
  } catch (error) {
    core.setFailed(error.message);
    if (error.response) {
      core.error(`Response data: ${JSON.stringify(error.response.data)}`);
    }
  }
}

run();
