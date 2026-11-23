self.__MIDDLEWARE_MATCHERS = [
  {
    "regexp": "^(?:\\/(_next\\/data\\/[^/]{1,}))?(?:\\/((?!_next\\/|icons\\/|favicon.ico|robots.txt).*))(\\.json|\\.rsc|\\.segments\\/.+\\.segment\\.rsc)?[\\/#\\?]?$",
    "originalSource": "/((?!_next/|icons/|favicon.ico|robots.txt).*)"
  }
];self.__MIDDLEWARE_MATCHERS_CB && self.__MIDDLEWARE_MATCHERS_CB()