package io.helio.billingapi;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.regex.Pattern;

record DeploymentState(String version, String artifactDigest) {
    private static final Pattern SHA256 = Pattern.compile("sha256:[0-9a-f]{64}");
    private static final Pattern CONTEXT = Pattern.compile("[a-z0-9][a-z0-9-]{0,63}");
    static final String PRODUCTION_CONTEXT = "billing-api";

    static DeploymentState load(Path stateDirectory, String version) {
        return load(stateDirectory, version, PRODUCTION_CONTEXT);
    }

    /** Each Tomcat context (test, uat, preprod, production) keeps its own serving-digest file. */
    static DeploymentState load(Path stateDirectory, String version, String context) {
        try {
            String digest = Files.readString(stateDirectory.resolve(stateFileName(context))).trim();
            if (!SHA256.matcher(digest).matches()) {
                throw new IllegalStateException("Current deployment digest is not an immutable SHA-256");
            }
            return new DeploymentState(version, digest);
        } catch (IOException error) {
            throw new IllegalStateException("Current Tomcat deployment evidence is unavailable", error);
        }
    }

    static String stateFileName(String context) {
        if (context == null || context.isBlank() || PRODUCTION_CONTEXT.equals(context)) {
            return "current-digest.txt";
        }
        if (!CONTEXT.matcher(context).matches()) {
            throw new IllegalStateException("Deployment context name is not acceptable");
        }
        return "current-digest-" + context + ".txt";
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
