package io.helio.billingapi;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.io.PrintWriter;
import java.io.StringWriter;
import java.lang.reflect.Proxy;
import java.nio.file.Files;
import java.nio.file.Path;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

/** Drives the servlet directly with minimal request/response doubles; no container needed. */
class HelloServletTest {
    private static final String DIGEST = "sha256:" + "ab".repeat(32);
    private static final String OTHER_DIGEST = "sha256:" + "cd".repeat(32);

    @TempDir Path stateDirectory;
    private HelloServlet servlet;

    @BeforeEach
    void startServlet() throws Exception {
        System.setProperty("helio.deployment.state.dir", stateDirectory.toString());
        servlet = new HelloServlet();
        servlet.init();
    }

    @AfterEach
    void stopServlet() {
        System.clearProperty("helio.deployment.state.dir");
    }

    @Test
    void healthReportsTheServingDigestOfTheProductionContext() throws Exception {
        Files.writeString(stateDirectory.resolve("current-digest.txt"), DIGEST + "\n");

        Exchange health = get("/billing-api", "/health");

        assertEquals(200, health.status());
        assertEquals("application/json", health.contentType());
        assertTrue(health.body().contains("\"status\":\"UP\""), health.body());
        assertTrue(health.body().contains("\"artifact_digest\":\"" + DIGEST + "\""), health.body());
        assertTrue(health.body().contains("\"runtime\":\"Apache Tomcat\""), health.body());
    }

    @Test
    void eachContextAnswersWithItsOwnDeployment() throws Exception {
        Files.writeString(stateDirectory.resolve("current-digest.txt"), DIGEST + "\n");
        Files.writeString(stateDirectory.resolve("current-digest-billing-api-test.txt"), OTHER_DIGEST + "\n");

        assertEquals(DIGEST, get("/billing-api", "/artifact-digest").body());
        assertEquals(OTHER_DIGEST, get("/billing-api-test", "/artifact-digest").body());
        assertEquals("text/plain", get("/billing-api-test", "/artifact-digest").contentType());
    }

    @Test
    void versionEndpointMatchesTheIdentityEmbeddedAtBuildTime() throws Exception {
        Files.writeString(stateDirectory.resolve("current-digest.txt"), DIGEST + "\n");

        Exchange version = get("/billing-api", "/version");
        Exchange health = get("/billing-api", "/health");

        assertEquals(200, version.status());
        assertTrue(health.body().contains("\"version\":\"" + version.body() + "\""), health.body());
    }

    @Test
    void landingPageShowsReleaseAndDigest() throws Exception {
        Files.writeString(stateDirectory.resolve("current-digest.txt"), DIGEST + "\n");
        String version = get("/billing-api", "/version").body();

        Exchange page = get("/billing-api", "/");

        assertEquals(200, page.status());
        assertEquals("text/html", page.contentType());
        assertTrue(page.body().startsWith("<!doctype html>"), page.body());
        assertTrue(page.body().contains("<strong>" + version + "</strong>"), page.body());
        assertTrue(page.body().contains("<code>" + DIGEST + "</code>"), page.body());
    }

    @Test
    void missingDeploymentEvidenceIsServiceUnavailable() throws Exception {
        Exchange health = get("/billing-api", "/health");

        assertEquals(503, health.status());
        assertTrue(health.body().contains("deployment evidence"), health.body());
    }

    @Test
    void unknownContextNamesAreRefused() throws Exception {
        Files.writeString(stateDirectory.resolve("current-digest.txt"), DIGEST + "\n");

        assertEquals(503, get("/../secrets", "/health").status());
    }

    record Exchange(int status, String contentType, String body) {}

    private Exchange get(String contextPath, String servletPath) throws IOException {
        HttpServletRequest request = (HttpServletRequest) Proxy.newProxyInstance(
                getClass().getClassLoader(), new Class<?>[] {HttpServletRequest.class},
                (proxy, method, args) -> switch (method.getName()) {
                    case "getServletPath" -> servletPath;
                    case "getContextPath" -> contextPath;
                    default -> defaultValue(method.getReturnType());
                });
        StringWriter body = new StringWriter();
        PrintWriter writer = new PrintWriter(body);
        int[] status = {0};
        String[] contentType = {null};
        HttpServletResponse response = (HttpServletResponse) Proxy.newProxyInstance(
                getClass().getClassLoader(), new Class<?>[] {HttpServletResponse.class},
                (proxy, method, args) -> switch (method.getName()) {
                    case "setStatus" -> {
                        status[0] = (int) args[0];
                        yield null;
                    }
                    case "sendError" -> {
                        status[0] = (int) args[0];
                        body.write(String.valueOf(args[1]));
                        yield null;
                    }
                    case "setContentType" -> {
                        contentType[0] = (String) args[0];
                        yield null;
                    }
                    case "getWriter" -> writer;
                    default -> defaultValue(method.getReturnType());
                });
        servlet.doGet(request, response);
        writer.flush();
        return new Exchange(status[0], contentType[0], body.toString());
    }

    private static Object defaultValue(Class<?> type) {
        if (type == boolean.class) {
            return false;
        }
        if (type == int.class) {
            return 0;
        }
        if (type == long.class) {
            return 0L;
        }
        return null;
    }
}
