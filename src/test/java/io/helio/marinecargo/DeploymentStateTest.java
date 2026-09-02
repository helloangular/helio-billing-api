package io.helio.marinecargo;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

class DeploymentStateTest {
    private static final String DIGEST =
            "sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

    @TempDir Path stateDirectory;

    @Test
    void readsTheDigestWrittenByTheTomcatDeployment() throws IOException {
        Files.writeString(stateDirectory.resolve("current-digest.txt"), DIGEST + "\n");

        DeploymentState state = DeploymentState.load(stateDirectory, "v4.0.0");

        assertEquals("v4.0.0", state.version());
        assertEquals(DIGEST, state.artifactDigest());
        assertEquals(
                "{\"status\":\"UP\",\"version\":\"v4.0.0\",\"artifact_digest\":\"" + DIGEST
                        + "\",\"runtime\":\"Apache Tomcat\"}",
                state.healthJson());
    }

    @Test
    void rejectsAStateFileThatIsNotAnImmutableSha256Digest() throws IOException {
        Files.writeString(stateDirectory.resolve("current-digest.txt"), "latest\n");

        assertThrows(IllegalStateException.class,
                () -> DeploymentState.load(stateDirectory, "v4.0.0"));
    }

    @Test
    void rejectsMissingDeploymentEvidence() {
        assertThrows(IllegalStateException.class,
                () -> DeploymentState.load(stateDirectory, "v4.0.0"));
    }
}
