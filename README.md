# upload-to-buildstash

A GitHub action for uploading build artifacts to Buildstash.


### Usage

```
  - name: Upload to Buildstash
    uses: Buildstash/upload-to-buildstash@v1.2.1
    with:
      api_key: ${{ secrets.BUILDSTASH_API_KEY }}
      structure: 'file'  # file for single file, file+expansion for expansion file
      primary_file_path: 'example.apk'
      version_component_1_major: '0'  # Pass in version components
      version_component_2_minor: '0'
      version_component_3_patch: '1'
      version_component_extra: 'beta'  # Optional extra and meta version components
      version_component_meta: '2024.12.01'
      custom_build_number: '12345' # Optional custom build number
      platform: 'android'  # Assuming platform is Android, see Buildstash documentation for other platforms
      stream: 'default'  # Exact name of a build stream in your app
      # Optional metadata artifacts (JSON format with optional descriptions)
      metadata_artifacts: |
        [
          {"path": "metadata.json", "description": "Build metadata and version info"},
          {"path": "changelog.md", "description": "Release notes and changes"},
          {"path": "readme.txt"}
        ]
      # Optional build associations
      labels: |
        to-review
        signed
      architectures: |
        armv6
        armv7
        armv8
        arm64v8
        armv9
      custom_target: 'my-custom-target' # Exact name of your custom target, associated with both app and platform
      # Optional CI information
      ci_pipeline: ${{ github.workflow }}
      ci_run_id: ${{ github.run_id }}
      ci_run_url: ${{ github.server_url }}/${{ github.repository }}/actions/runs/${{ github.run_id }}
      # Optional VC information
      vc_host_type: 'git'
      vc_host: 'github'
      vc_repo_name: ${{ github.repository }}
      vc_repo_url: ${{ github.server_url }}/${{ github.repository }}
      vc_branch: ${{ github.ref_name }}
      vc_commit_sha: ${{ github.sha }}
      vc_commit_url: ${{ github.server_url }}/${{ github.repository }}/commit/${{ github.sha }}
```

### Upload expansion file
You may also optionally pass in a single expansion file, if the platform / primary file supports it. For example, if you upload an .apk, you could upload an .obb with it. To do so set 'structure' to `file+expansion`, and pass in 'expansion_file_path'.

### Upload metadata files
Optional related metadata files can be uploaded alongside the binaries for your actual build. These may include SBOMs (SPDX / CycloneDX), build logs, test results, changelogs, etc.

**Format:** JSON array with `path` (required) and `description` (optional) fields.

**Examples:**
```yaml
# With descriptions
metadata_artifacts: |
  [
    {"path": "metadata.json", "description": "Build metadata and version info"},
    {"path": "changelog.md", "description": "Release notes and changes"},
    {"path": "sbom.spdx", "description": "Software Bill of Materials"}
  ]

# Without descriptions
metadata_artifacts: |
  [
    {"path": "metadata.json"},
    {"path": "changelog.md"}
  ]

# Mixed (some with, some without descriptions)
metadata_artifacts: |
  [
    {"path": "metadata.json", "description": "Build metadata"},
    {"path": "changelog.md"}
  ]
```

**Note:** Maximum of 10 metadata files per upload. Additional files will be skipped with a warning.

### API key
You will need to generate an application specific API key, and save it as an [Actions secret](https://docs.github.com/en/actions/security-for-github-actions/security-guides/using-secrets-in-github-actions) in your repository.

### More help
**For more help, please see the [GitHub Actions setup in Buildstash documentation](https://docs.buildstash.com/integrations/ci/github).**