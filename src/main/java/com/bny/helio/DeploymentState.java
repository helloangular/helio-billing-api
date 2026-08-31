package com.bny.helio;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.regex.Pattern;

record DeploymentState(String version, String artifactDigest) {
    private static final Pattern SHA256 = Pattern.compile("sha256:[0-9a-f]{64}");

    static DeploymentState load(Path stateDirectory, String version) {
        try {
            String digest = Files.readString(stateDirectory.resolve("current-digest.txt")).trim();
            if (!SHA256.matcher(digest).matches()) {
                throw new IllegalStateException("Current deployment digest is not an immutable SHA-256");
            }
            return new DeploymentState(version, digest);
        } catch (IOException error) {
            throw new IllegalStateException("Current Tomcat deployment evidence is unavailable", error);
        }
    }

    String healthJson() {
        return "{\"status\":\"UP\",\"version\":\"" + json(version)
                + "\",\"artifact_digest\":\"" + artifactDigest
                + "\",\"runtime\":\"Apache Tomcat\"}";
    }

    private static String json(String value) {
        return value.replace("\\", "\\\\").replace("\"", "\\\"");
    }
}
