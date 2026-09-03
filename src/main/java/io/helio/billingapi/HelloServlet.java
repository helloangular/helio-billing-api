package io.helio.billingapi;

import jakarta.servlet.ServletException;
import jakarta.servlet.annotation.WebServlet;
import jakarta.servlet.http.HttpServlet;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Path;
import java.util.Properties;

@WebServlet(urlPatterns = {"/", "/health", "/artifact-digest", "/version"})
public final class HelloServlet extends HttpServlet {
    private String version;
    private Path stateDirectory;

    @Override
    public void init() throws ServletException {
        Properties properties = new Properties();
        try (InputStream input = getClass().getResourceAsStream("/release.properties")) {
            if (input == null) {
                throw new IOException("release.properties is missing");
            }
            properties.load(input);
            version = properties.getProperty("release.version");
        } catch (IOException error) {
            throw new ServletException("Unable to load immutable release identity", error);
        }
        String configured = System.getProperty(
                "helio.deployment.state.dir",
                Path.of(System.getProperty("user.home"), ".helio-tomcat").toString());
        stateDirectory = Path.of(configured).toAbsolutePath().normalize();
    }

    @Override
    protected void doGet(HttpServletRequest request, HttpServletResponse response) throws IOException {
        DeploymentState state;
        String context = request.getContextPath().replaceFirst("^/", "");
        try {
            state = DeploymentState.load(stateDirectory, version, context);
        } catch (IllegalStateException error) {
            response.sendError(HttpServletResponse.SC_SERVICE_UNAVAILABLE, error.getMessage());
            return;
        }

        switch (request.getServletPath()) {
            case "/health" -> write(response, "application/json", state.healthJson());
            case "/artifact-digest" -> write(response, "text/plain", state.artifactDigest());
            case "/version" -> write(response, "text/plain", state.version());
            default -> write(response, "text/html", page(state));
        }
    }

    private static void write(HttpServletResponse response, String contentType, String body)
            throws IOException {
        response.setStatus(HttpServletResponse.SC_OK);
        response.setContentType(contentType);
        response.setCharacterEncoding(StandardCharsets.UTF_8.name());
        response.getWriter().write(body);
    }

    private static String page(DeploymentState state) {
        return "<!doctype html><html><head><title>Helio Billing API</title>"
                + "<meta name=viewport content='width=device-width,initial-scale=1'>"
                + "<style>body{font:18px system-ui;margin:4rem;max-width:800px}"
                + "code{overflow-wrap:anywhere;color:#075985}.ok{color:#15803d}</style></head>"
                + "<body><h1>Hello from Billing API</h1><p class=ok>Running on Apache Tomcat</p>"
                + "<p>Release: <strong>" + html(state.version()) + "</strong></p>"
                + "<p>WAR digest: <code>" + state.artifactDigest() + "</code></p>"
                + "<p><a href='health'>Health</a> · <a href='artifact-digest'>Serving digest</a></p>"
                + "</body></html>";
    }

    private static String html(String value) {
        return value.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
                .replace("\"", "&quot;").replace("'", "&#39;");
    }
}
