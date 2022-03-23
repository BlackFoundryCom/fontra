import pathlib
import secrets
from .backends import getBackendClass
from .fonthandler import FontHandler


async def getFileSystemBackend(path):
    path = pathlib.Path(path)
    if not path.exists():
        raise FileNotFoundError(path)
    print(f"loading project {path.name}...")
    fileType = path.suffix.lstrip(".")
    backendClass = getBackendClass(fileType)
    return backendClass.fromPath(path)


class FileSystemProjectManager:

    remoteMethodNames = {"getProjectList"}
    requireLogin = False

    def __init__(self, rootPath, maxFolderDepth=3):
        self.rootPath = rootPath
        self.maxFolderDepth = maxFolderDepth
        self.extensions = {".designspace", ".ufo", ".rcjk"}
        self.fontHandlers = {}
        self.connections = {}

    async def __aenter__(self):
        await log("entering context")

    async def __aexit__(self, exc_type, exc, tb):
        await log("exiting context")

    async def login(self, username, password):
        # dummy, for testing
        if password == "a":
            return secrets.token_hex(32)
        return None

    def projectExists(self, token, *pathItems):
        projectPath = self.rootPath.joinpath(*pathItems)
        return projectPath.exists()

    async def getRemoteSubject(self, path, token, remoteIP):
        if path == "/":
            return self
        pathItems = tuple(path.split("/"))
        assert pathItems[0] == ""
        pathItems = pathItems[1:]
        assert all(item for item in pathItems)
        fontHandler = self.fontHandlers.get(pathItems)
        if fontHandler is None:
            projectPath = self.rootPath.joinpath(*pathItems)
            if not projectPath.exists():
                raise FileNotFoundError(projectPath)
            backend = await getFileSystemBackend(projectPath)
            fontHandler = FontHandler(backend, self.connections)
            self.fontHandlers[pathItems] = fontHandler
        return fontHandler

    async def getProjectList(self, *, connection):
        projectPaths = []
        rootItems = self.rootPath.parts
        paths = sorted(_iterFolder(self.rootPath, self.extensions, self.maxFolderDepth))
        for projectPath in paths:
            projectItems = projectPath.parts
            assert projectItems[: len(rootItems)] == rootItems
            projectPaths.append("/".join(projectItems[len(rootItems) :]))
        return projectPaths


def _iterFolder(folderPath, extensions, maxDepth=3):
    if maxDepth is not None and maxDepth <= 0:
        return
    for childPath in folderPath.iterdir():
        if childPath.suffix.lower() in extensions:
            yield childPath
        elif childPath.is_dir():
            yield from _iterFolder(
                childPath, extensions, maxDepth - 1 if maxDepth is not None else None
            )
