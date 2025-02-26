const core = require('@actions/core');
const fs = require('fs');
const axios = require('axios');
const FormData = require('form-data');
const path = require('path');

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

    const { pending_upload_id, primary_presigned_data, expansion_files } = uploadRequest.data;

    // Upload primary file
    core.info('Uploading primary file...');
    await axios.put(
      primary_presigned_data.url,
      fs.createReadStream(primaryFilePath),
      {
        headers: {
          'Content-Type': primary_presigned_data.headers['Content-Type'],
          'Content-Length': primary_presigned_data.headers['Content-Length'],
          'Content-Disposition': primary_presigned_data.headers['Content-Disposition'],
          'x-amz-acl': 'private'
        },
        maxBodyLength: Infinity
      }
    );

    // Upload expansion file if present
    if (expansionFilePath) {
      core.info('Uploading expansion file...');
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

    // Verify upload
    core.info('Verifying upload...');
    const verifyResponse = await axios.post(
      'https://app.buildstash.com/api/v1/upload/verify',
      { pending_upload_id },
      {
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        }
      }
    );

    core.info('Upload completed and verified successfully!');
    
  } catch (error) {
    core.setFailed(error.message);
    if (error.response) {
      core.error(`Response data: ${JSON.stringify(error.response.data)}`);
    }
  }
}

run();
